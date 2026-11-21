import { test } from "node:test";
import assert from "node:assert/strict";
import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import {
  ThreadRouter,
  type CompactionInfo,
  type SubagentDone,
  type SubagentStart,
  type ThreadSink,
} from "../threadRouter.js";

function recorder() {
  const rec = {
    root: [] as string[],
    starts: [] as SubagentStart[],
    deltas: [] as Array<[string, string, string]>,
    dones: [] as SubagentDone[],
    compactions: [] as CompactionInfo[],
  };
  const sink: ThreadSink = {
    onRootDelta: (t) => rec.root.push(t),
    onSubagentStart: (s) => rec.starts.push(s),
    onSubagentDelta: (id, name, t) => rec.deltas.push([id, name, t]),
    onSubagentDone: (d) => rec.dones.push(d),
    onCompaction: (c) => rec.compactions.push(c),
  };
  return { rec, router: new ThreadRouter(sink) };
}

const ev = (e: Record<string, unknown>) => e as unknown as TrueForgeApi.TurnStreamingEvent;
const delta = (threadId: string, content: string) =>
  ev({ type: "model.message.delta", id: "d", threadId, content, createdAt: "2026-11-22T10:00:00.000Z" });
const created = ev({
  type: "thread.created",
  id: "c",
  threadId: "T1",
  title: "explorer",
  agentInfo: { name: "explorer", input: "find files", type: "dynamic" },
  parent: { threadId: "T0", toolCallId: "c1" },
  createdAt: "2026-11-22T10:00:00.000Z",
});
const done = (threadId: string, state: Record<string, unknown>) =>
  ev({ type: "thread.done", id: "x", threadId, title: "explorer", state, createdAt: "2026-11-22T10:00:04.500Z" });

test("root deltas go to onRootDelta", () => {
  const { rec, router } = recorder();
  router.handle(delta("T0", "hi"));
  assert.deepEqual(rec.root, ["hi"]);
  assert.equal(rec.starts.length + rec.deltas.length + rec.dones.length, 0);
});

test("thread.created starts a named subagent", () => {
  const { rec, router } = recorder();
  router.handle(delta("T0", "a"));
  router.handle(created);
  assert.deepEqual(rec.starts, [
    { threadId: "T1", name: "explorer", input: "find files", parentThreadId: "T0", parentToolCallId: "c1", at: "2026-11-22T10:00:00.000Z" },
  ]);
  assert.equal(router.subagentName("T1"), "explorer");
  assert.equal(router.subagentName("T0"), undefined);
});

test("child deltas are routed to the subagent", () => {
  const { rec, router } = recorder();
  router.handle(delta("T0", "a"));
  router.handle(created);
  router.handle(delta("T1", "x"));
  assert.deepEqual(rec.deltas, [["T1", "explorer", "x"]]);
  assert.deepEqual(rec.root, ["a"]);
});

test("unknown non-root thread is treated as a subagent", () => {
  const { rec, router } = recorder();
  router.handle(delta("T0", "a"));
  router.handle(delta("T9", "leak"));
  assert.deepEqual(rec.deltas, [["T9", "subagent", "leak"]]);
  assert.deepEqual(rec.root, ["a"]);
});

test("thread.done ok computes duration", () => {
  const { rec, router } = recorder();
  router.handle(delta("T0", "a"));
  router.handle(created);
  router.handle(done("T1", { status: "done" }));
  assert.equal(rec.dones.length, 1);
  assert.equal(rec.dones[0].ok, true);
  assert.equal(rec.dones[0].durationMs, 4500);
  assert.equal(rec.dones[0].name, "explorer");
});

test("thread.done error", () => {
  const { rec, router } = recorder();
  router.handle(created);
  router.handle(done("T1", { status: "error", error: "boom" }));
  assert.equal(rec.dones[0].ok, false);
  assert.equal(rec.dones[0].error, "boom");
});

test("thread.done without start has no duration", () => {
  const { rec, router } = recorder();
  router.handle(done("T5", { status: "done" }));
  assert.equal(rec.dones[0].durationMs, undefined);
});

test("compaction events", () => {
  const { rec, router } = recorder();
  const trigger = { type: "context_threshold_exceeded", contextTokens: 41000, thresholdTokens: 32000 };
  router.handle(ev({ type: "thread.context_compaction_started", id: "s", threadId: "T0", trigger, createdAt: "2026-11-22T10:00:01.000Z" }));
  router.handle(ev({ type: "thread.context_compaction_finished", id: "f", threadId: "T0", trigger, durationMs: 1800, usage: {}, createdAt: "2026-11-22T10:00:02.800Z" }));
  assert.equal(rec.compactions[0].phase, "started");
  assert.equal(rec.compactions[0].contextTokens, 41000);
  assert.equal(rec.compactions[0].thresholdTokens, 32000);
  assert.equal(rec.compactions[1].phase, "finished");
  assert.equal(rec.compactions[1].durationMs, 1800);
});

test("thread events for the root thread are ignored", () => {
  const { rec, router } = recorder();
  router.handle(delta("main", "a"));
  router.handle(done("main", { status: "done" }));
  assert.equal(rec.dones.length, 0);
  assert.equal(router.subagentName("main"), undefined);
});
