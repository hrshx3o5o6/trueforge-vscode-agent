/**
 * Runs a turn against the primary model; on any failure (thrown exception
 * from the SDK, or a turn.done event reporting a failed/errored status),
 * automatically retries once against the fallback model with zero user
 * action — targets B3's top anchor (docs/SCORING_MAP.md).
 *
 * ASSUMPTION TO VERIFY (docs/SETUP.md "known gaps"): the exact shape of a
 * failed turn.done event (event.state.status value) isn't confirmed from
 * the docs skimmed so far — this checks for a few plausible status
 * strings and should be corrected against a real failing run before the
 * Task C rehearsal.
 */
import type { TrueForge } from "@truefoundry/trueforge-sdk";
import { buildAgentSpec, type AgentModelConfig } from "./trueforgeClient.js";

export type TurnEventHandler = (event: unknown) => void;

export interface RunTurnResult {
  usedFallback: boolean;
  error?: string;
}

const FAILURE_STATUSES = new Set(["failed", "error", "errored", "cancelled_error"]);

function isFailedTurnDone(event: unknown): boolean {
  if (typeof event !== "object" || event === null) return false;
  const e = event as { type?: string; state?: { status?: string } };
  return e.type === "turn.done" && !!e.state?.status && FAILURE_STATUSES.has(e.state.status);
}

async function runOnce(
  client: TrueForge,
  model: AgentModelConfig,
  userMessage: string,
  onEvent: TurnEventHandler,
): Promise<{ failed: boolean; error?: string }> {
  const { data: session } = await client.sessions.create({ agent: buildAgentSpec(model) });
  const stream = await client.sessions.createTurnStream(session.id, {
    input: [{ type: "user.message", content: userMessage }],
  });

  let failed = false;
  for await (const { data: event } of stream.withMetadata()) {
    onEvent(event);
    if (isFailedTurnDone(event)) failed = true;
  }
  return { failed };
}

export async function runTurnWithFallback(
  client: TrueForge,
  primary: AgentModelConfig,
  fallback: AgentModelConfig | undefined,
  userMessage: string,
  onEvent: TurnEventHandler,
  onFallbackTriggered: () => void,
): Promise<RunTurnResult> {
  try {
    const result = await runOnce(client, primary, userMessage, onEvent);
    if (!result.failed) return { usedFallback: false };
  } catch (err) {
    // fall through to fallback attempt below
    if (!fallback) return { usedFallback: false, error: String(err) };
  }

  if (!fallback) {
    return { usedFallback: false, error: "Primary model failed and no fallback model is configured." };
  }

  onFallbackTriggered();
  try {
    await runOnce(client, fallback, userMessage, onEvent);
    return { usedFallback: true };
  } catch (err) {
    return { usedFallback: true, error: String(err) };
  }
}
