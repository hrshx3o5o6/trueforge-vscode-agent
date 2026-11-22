/**
 * Sorts streamed TrueForge events by thread. A turn has one root thread
 * (the agent the user talks to) and, when the agent calls TrueForge's
 * create_sub_agent system tool, child threads. Only root-thread text
 * belongs in the main transcript; child output is attributed to its
 * subagent, and thread.* / compaction events become typed callbacks.
 *
 * The root is the thread of the first model message seen in the turn.
 * Any other thread is a subagent, even before its thread.created event
 * arrives (named "subagent" until then), so child text can never leak
 * into the main answer.
 */
import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";

export interface SubagentStart { threadId: string; name: string; input: string; parentThreadId: string; parentToolCallId: string; at: string }
export interface SubagentDone { threadId: string; name: string; ok: boolean; error?: string; at: string; durationMs?: number }
export interface CompactionInfo { threadId: string; phase: "started" | "finished"; contextTokens: number; thresholdTokens: number; durationMs?: number; at: string }

export interface ThreadSink {
  onRootDelta(text: string): void;
  onSubagentStart(s: SubagentStart): void;
  onSubagentDelta(threadId: string, name: string, text: string): void;
  onSubagentDone(d: SubagentDone): void;
  onCompaction(c: CompactionInfo): void;
}

const UNNAMED = "subagent";

export class ThreadRouter {
  private readonly sink: ThreadSink;
  private root: string | undefined;
  private readonly children = new Map<string, { name: string; startedAt?: string }>();

  constructor(sink: ThreadSink) {
    this.sink = sink;
  }

  /** Name of the subagent that owns this thread, or undefined for the root thread. */
  subagentName(threadId: string): string | undefined {
    if (threadId === this.root) {return undefined;}
    return this.children.get(threadId)?.name ?? (this.root === undefined ? undefined : UNNAMED);
  }

  handle(e: TrueForgeApi.TurnStreamingEvent): void {
    switch (e.type) {
      case "model.message":
      case "model.message.delta": {
        if (this.root === undefined && !this.children.has(e.threadId)) {this.root = e.threadId;}
        if (e.type === "model.message" || !e.content) {return;}
        if (e.threadId === this.root) {
          this.sink.onRootDelta(e.content);
        } else {
          this.sink.onSubagentDelta(e.threadId, this.subagentName(e.threadId) ?? UNNAMED, e.content);
        }
        return;
      }
      case "thread.created": {
        this.children.set(e.threadId, { name: e.agentInfo.name, startedAt: e.createdAt });
        this.sink.onSubagentStart({
          threadId: e.threadId,
          name: e.agentInfo.name,
          input: e.agentInfo.input,
          parentThreadId: e.parent.threadId,
          parentToolCallId: e.parent.toolCallId,
          at: e.createdAt,
        });
        return;
      }
      case "thread.done": {
        if (e.threadId === this.root) {return;}
        const child = this.children.get(e.threadId);
        const started = child?.startedAt ? Date.parse(child.startedAt) : NaN;
        const ended = Date.parse(e.createdAt);
        this.sink.onSubagentDone({
          threadId: e.threadId,
          name: child?.name ?? e.title ?? UNNAMED,
          ok: e.state.status === "done",
          error: e.state.status === "error" ? e.state.error : undefined,
          at: e.createdAt,
          durationMs: Number.isFinite(started) && Number.isFinite(ended) ? ended - started : undefined,
        });
        return;
      }
      case "thread.context_compaction_started":
      case "thread.context_compaction_finished":
        this.sink.onCompaction({
          threadId: e.threadId,
          phase: e.type === "thread.context_compaction_started" ? "started" : "finished",
          contextTokens: e.trigger.contextTokens,
          thresholdTokens: e.trigger.thresholdTokens,
          durationMs: e.type === "thread.context_compaction_finished" ? e.durationMs : undefined,
          at: e.createdAt,
        });
        return;
    }
  }
}
