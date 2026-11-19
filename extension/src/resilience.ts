/**
 * Runs a turn against the primary model; on any failure (thrown exception
 * from the SDK, or a turn.done event reporting a failed/errored status),
 * automatically retries once against the fallback model with zero user
 * action — targets B3's top anchor (docs/SCORING_MAP.md).
 *
 * CHAT HISTORY FIX (found live, 2026-11-19): a session's agent spec is
 * fixed at creation — TrueForge's own reference.md: "Named sessions
 * snapshot the agent name at create and resolve the live agent on each
 * turn" (and inline specs are snapshotted too, never re-resolved). The
 * original version called client.sessions.create() on every single
 * runTurnWithFallback call, so every "Send" in the chat panel started a
 * brand new session with zero memory of prior turns — confirmed directly
 * in the TrueForge server log (one POST /api/v1/sessions per message,
 * not one per conversation). Fixed by accepting/returning a sessionId:
 * callers now persist it (extension.ts keeps one per open chat panel)
 * and pass it back in on the next turn, so createTurnStream reuses the
 * same session instead of create() making a new one.
 *
 * Falling back to a second model necessarily starts a NEW session (a
 * session's agent/model can't be swapped after creation) — history is
 * lost on that rare path, which is an accepted, documented tradeoff:
 * Task C's resilience test is a single-turn scenario, not an ongoing
 * conversation, so this doesn't cost anything in practice.
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
  /** The session actually used for this turn — persist and pass back in
   * as existingSessionId on the next call to keep chat history. */
  sessionId: string;
}

const FAILURE_STATUSES = new Set(["failed", "error", "errored", "cancelled_error"]);

function isFailedTurnDone(event: unknown): boolean {
  if (typeof event !== "object" || event === null) {
    return false;
  }
  const e = event as { type?: string; state?: { status?: string } };
  return e.type === "turn.done" && !!e.state?.status && FAILURE_STATUSES.has(e.state.status);
}

async function runOnce(
  client: TrueForge,
  model: AgentModelConfig,
  userMessage: string,
  onEvent: TurnEventHandler,
  existingSessionId: string | undefined,
): Promise<{ failed: boolean; error?: string; sessionId: string }> {
  let sessionId = existingSessionId;

  if (!sessionId) {
    const { data: session } = await client.sessions.create({ agent: buildAgentSpec(model) });
    sessionId = session.id;
  }

  let stream;
  try {
    stream = await client.sessions.createTurnStream(sessionId, {
      input: [{ type: "user.message", content: userMessage }],
    });
  } catch (err) {
    if (!existingSessionId) {
      throw err; // a brand-new session failing is a real error, not a stale-session issue
    }
    // Self-heal: the reused session may have expired/been dropped (e.g.
    // TrueForge restarted) — start a fresh one rather than hard-failing
    // a turn just because history couldn't be preserved.
    const { data: session } = await client.sessions.create({ agent: buildAgentSpec(model) });
    sessionId = session.id;
    stream = await client.sessions.createTurnStream(sessionId, {
      input: [{ type: "user.message", content: userMessage }],
    });
  }

  let failed = false;
  for await (const { data: event } of stream.withMetadata()) {
    onEvent(event);
    if (isFailedTurnDone(event)) {
      failed = true;
    }
  }
  return { failed, sessionId };
}

export async function runTurnWithFallback(
  client: TrueForge,
  primary: AgentModelConfig,
  fallback: AgentModelConfig | undefined,
  userMessage: string,
  onEvent: TurnEventHandler,
  onFallbackTriggered: () => void,
  existingSessionId?: string,
): Promise<RunTurnResult> {
  try {
    const result = await runOnce(client, primary, userMessage, onEvent, existingSessionId);
    if (!result.failed) {
      return { usedFallback: false, sessionId: result.sessionId };
    }
  } catch (err) {
    if (!fallback) {
      return { usedFallback: false, error: String(err), sessionId: existingSessionId ?? "" };
    }
  }

  if (!fallback) {
    return {
      usedFallback: false,
      error: "Primary model failed and no fallback model is configured.",
      sessionId: existingSessionId ?? "",
    };
  }

  onFallbackTriggered();
  try {
    // Deliberately NOT passing existingSessionId here — see the module
    // doc comment above: a session's model can't be swapped, so the
    // fallback model always needs its own fresh session.
    const result = await runOnce(client, fallback, userMessage, onEvent, undefined);
    return { usedFallback: true, sessionId: result.sessionId };
  } catch (err) {
    return { usedFallback: true, error: String(err), sessionId: existingSessionId ?? "" };
  }
}
