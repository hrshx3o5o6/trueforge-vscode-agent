/**
 * Runs one user request as a TrueForge turn, end to end:
 *
 * - streams model.message.delta tokens to the UI as they arrive;
 * - answers TrueForge-native tool.approval_required events by asking the
 *   UI (diff review / command approval) and posting user.tool_approval
 *   back to the turn — whether TrueForge keeps the stream open while
 *   paused or closes it, we resume via subscribeToTurn until turn.done;
 * - cancels for real: aborts the HTTP stream AND calls sessions.cancel;
 * - watches for stalls (no event for N seconds while not waiting on the
 *   user) so an unreachable model endpoint can't hang the editor;
 * - retries the primary model with exponential backoff, then falls back
 *   to the fallback model automatically (Task C / B3).
 *
 * Workspace consistency is the caller's job via beforeRetry/onCancel
 * hooks (extension.ts rolls back edits applied by a failed attempt).
 */
import type { TrueForge, TrueForgeApi } from "@truefoundry/trueforge-sdk";
import { buildAgentSpec, type AgentModelConfig } from "./trueforgeClient.js";

export interface ApprovalRequest {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}
export type ApprovalAnswer = { allow: true } | { allow: false; reason: string };

export interface TurnCallbacks {
  onDelta: (text: string) => void;
  onToolCall: (name: string, args: Record<string, unknown>) => void;
  onStatus: (message: string, level: "info" | "warn" | "error") => void;
  onApproval: (req: ApprovalRequest) => Promise<ApprovalAnswer>;
  /** Called before a retry / fallback so the caller can undo a failed attempt's edits. */
  beforeRetry: () => Promise<void>;
}

export interface TurnOptions {
  primary: AgentModelConfig;
  fallback?: AgentModelConfig;
  maxRetries: number;
  stallTimeoutSeconds: number;
  sessionId?: string;
}

export interface TurnResult {
  status: "done" | "cancelled" | "failed";
  error?: string;
  usedFallback: boolean;
  sessionId?: string;
  model?: string;
}

type AttemptOutcome = { status: "done" | "cancelled" | "failed"; error?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errorText(err: unknown): string {
  const e = err as { message?: string; statusCode?: number; body?: { error?: { message?: string } } };
  const detail = e?.body?.error?.message ?? e?.message ?? String(err);
  return e?.statusCode ? `HTTP ${e.statusCode}: ${detail}` : detail;
}

export class TurnController {
  private cancelled = false;
  private abort = new AbortController();
  private sessionId: string | undefined;
  private awaitingUser = 0;
  private lastEventAt = Date.now();
  private stallMs = 90_000;

  constructor(
    private readonly client: TrueForge,
    private readonly cb: TurnCallbacks,
  ) {}

  get isCancelled(): boolean {return this.cancelled;}

  /** Immediate: stops local processing, aborts the stream, cancels server-side. */
  async cancel(): Promise<void> {
    if (this.cancelled) {return;}
    this.cancelled = true;
    this.abort.abort();
    if (this.sessionId) {
      await this.client.sessions.cancel(this.sessionId).catch(() => undefined);
    }
  }

  async run(userMessage: string, opts: TurnOptions): Promise<TurnResult> {
    this.stallMs = opts.stallTimeoutSeconds * 1000;
    const plan: Array<{ model: AgentModelConfig; fallback: boolean }> = [];
    for (let i = 0; i <= opts.maxRetries; i++) {plan.push({ model: opts.primary, fallback: false });}
    if (opts.fallback?.name) {plan.push({ model: opts.fallback, fallback: true });}

    let sessionId = opts.sessionId;
    let lastError = "";
    for (let i = 0; i < plan.length; i++) {
      const { model, fallback } = plan[i];
      if (this.cancelled) {return { status: "cancelled", usedFallback: fallback, sessionId };}
      if (i > 0) {
        await this.cb.beforeRetry();
        if (fallback) {
          this.cb.onStatus(`Primary model failed (${lastError}). Switching to fallback model ${model.name} automatically.`, "warn");
          sessionId = undefined; // a session's model is fixed at creation
        } else {
          const delay = 1000 * 2 ** (i - 1);
          this.cb.onStatus(`Attempt ${i} on ${model.name} failed (${lastError}). Retrying in ${delay / 1000}s…`, "warn");
          await sleep(delay);
        }
      }
      try {
        if (!sessionId) {
          const { data } = await this.client.sessions.create({ agent: buildAgentSpec(model) }, { abortSignal: this.abort.signal });
          sessionId = data.id;
        }
        this.sessionId = sessionId;
        const outcome = await this.attempt(sessionId, userMessage);
        if (outcome.status !== "failed") {
          return { status: outcome.status, usedFallback: fallback, sessionId, model: model.name };
        }
        lastError = outcome.error ?? "unknown error";
      } catch (err) {
        if (this.cancelled) {return { status: "cancelled", usedFallback: fallback, sessionId };}
        lastError = errorText(err);
        // A stale reused session (e.g. TrueForge restarted) — start fresh next time.
        if (/404|not found/i.test(lastError)) {sessionId = undefined;}
      }
    }
    await this.cb.beforeRetry();
    return { status: "failed", error: lastError, usedFallback: !!opts.fallback?.name, sessionId };
  }

  private async attempt(sessionId: string, userMessage: string): Promise<AttemptOutcome> {
    const toolCalls = new Map<string, { name: string; args: Record<string, unknown> }>();
    const pendingApprovals: Promise<void>[] = [];
    let turnId: string | undefined;
    let outcome: AttemptOutcome | undefined;
    let stalled = false;

    this.lastEventAt = Date.now();
    const stallMs = this.stallMs;
    const watchdog = setInterval(() => {
      if (this.awaitingUser === 0 && Date.now() - this.lastEventAt > stallMs) {
        stalled = true;
        this.abort.abort();
      }
    }, 1000);

    const handle = (e: TrueForgeApi.TurnStreamingEvent | TrueForgeApi.SessionEvent): void => {
      this.lastEventAt = Date.now();
      switch (e.type) {
        case "turn.created":
          turnId = e.turnId;
          break;
        case "model.message.delta":
          if (e.content) {this.cb.onDelta(e.content);}
          break;
        case "model.message":
          for (const tc of e.toolCalls ?? []) {
            const name = tc.toolInfo?.type === "mcp" ? tc.toolInfo.name : tc.function.name;
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* keep {} */ }
            toolCalls.set(tc.id, { name, args });
            this.cb.onToolCall(name, args);
          }
          break;
        case "tool.approval_required":
          for (const ref of e.toolCalls) {
            pendingApprovals.push(this.answerApproval(sessionId, () => turnId, e.threadId, ref.id, toolCalls.get(ref.id)));
          }
          break;
        case "turn.done":
          outcome =
            e.state.status === "done" ? { status: "done" }
            : e.state.status === "cancelled" ? { status: "cancelled" }
            : { status: "failed", error: e.state.message };
          break;
      }
    };

    try {
      let stream = await this.client.sessions.createTurnStream(
        sessionId,
        { input: [{ type: "user.message", content: userMessage }] },
        { abortSignal: this.abort.signal, timeoutInSeconds: 3600 },
      );
      for (let resumes = 0; resumes < 50; resumes++) {
        for await (const { data } of stream.withMetadata()) {
          handle(data);
          if (outcome) {break;}
        }
        if (outcome || this.cancelled || !turnId) {break;}
        // Stream closed while the turn is paused on approval: wait for the
        // user's decisions to be posted, then resubscribe to continue.
        this.awaitingUser++;
        try { await Promise.all(pendingApprovals.splice(0)); } finally { this.awaitingUser--; }
        this.lastEventAt = Date.now();
        stream = await this.client.sessions.subscribeToTurn(sessionId, turnId, {}, { abortSignal: this.abort.signal, timeoutInSeconds: 3600 });
      }
    } catch (err) {
      if (this.cancelled) {return { status: "cancelled" };}
      if (stalled) {
        await this.client.sessions.cancel(sessionId).catch(() => undefined);
        this.abort = new AbortController();
        return { status: "failed", error: `no response from TrueForge/model for ${stallMs / 1000}s` };
      }
      throw err;
    } finally {
      clearInterval(watchdog);
    }
    if (this.cancelled) {return { status: "cancelled" };}
    return outcome ?? { status: "failed", error: "stream ended without turn.done" };
  }

  private async answerApproval(
    sessionId: string,
    turnId: () => string | undefined,
    threadId: string,
    toolCallId: string,
    call: { name: string; args: Record<string, unknown> } | undefined,
  ): Promise<void> {
    this.awaitingUser++;
    let answer: ApprovalAnswer;
    try {
      answer = this.cancelled
        ? { allow: false, reason: "The user cancelled the run." }
        : await this.cb.onApproval({ toolCallId, toolName: call?.name ?? "unknown", args: call?.args ?? {} });
    } catch (err) {
      answer = { allow: false, reason: `Review failed: ${errorText(err)}` };
    } finally {
      this.awaitingUser--;
      this.lastEventAt = Date.now();
    }
    const id = turnId();
    if (!id || this.cancelled) {return;}
    await this.client.sessions.createTurnEvents(sessionId, id, {
      events: [
        {
          type: "user.tool_approval",
          threadId,
          toolCallId,
          approval: answer.allow ? { status: "allow" } : { status: "deny", reason: answer.reason },
        },
      ],
    });
  }
}
