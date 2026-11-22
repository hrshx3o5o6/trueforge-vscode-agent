# Visible Subagents + Harness-level Agent Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TrueForge dynamic subagents actually happen in Task B and show them (panel, Agent Trace, TrueForge session UI), so rubric B4 is claimable at 10, then correct the write-up.

**Architecture:** A new pure module `threadRouter.ts` classifies every streamed TrueForge event by thread (root vs. subagent) and turns `thread.*` events into typed callbacks. `turnRunner.ts` creates one router per attempt and forwards its callbacks; `extension.ts` posts them to the webview; the panel renders subagent cards and feeds Harsha's Agent Trace, which is reworked to record harness events.

**Tech Stack:** TypeScript, VS Code extension API, `@truefoundry/trueforge-sdk@0.185.0`, esbuild, Node's built-in `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-22-subagents-and-trace-design.md`

## Global Constraints
- Branch `feature/subagents`.
- **Each commit ≈200 changed lines or fewer** (`git diff --cached --shortstat` before committing). If a task's diff is larger, split it into several commits along the task's steps. **No Claude attribution in any commit message or PR** (no `Co-Authored-By: Claude`, no "Generated with Claude Code").
- Inline edit must never spawn subagents; Task A behaviour and timing unchanged.
- Task B must still succeed if the model does not delegate.
- No rubric codes (`A1`…`C2`) anywhere in the UI or trace export.
- Cancel/rollback behaviour unchanged: after cancel at any point, `git status` in the flask repo is clean.
- `npm run compile` (check-types + lint + esbuild) must stay clean after every task.
- Write-up PDF: 1–3 pages, the brief's eight headings in order.

## Review Focus
1. A child thread's delta arriving **before** its `thread.created` must not leak into the main transcript → tested in Task 2 (`unknown non-root thread is treated as a subagent`).
2. A subagent that ends with `status: "error"` shows as failed with its error, and the main run continues → tested in Task 2 (`thread.done error`).
3. Retry/fallback after a failed attempt: subagent cards from the failed attempt must not stay "running" → Task 4 step closes open cards on `done`/`run_started`; Task 6 checks it with an invalid primary model.
4. Cancel while the explorer is running leaves the workspace clean and the card marked cancelled → Task 6 step 5.
5. Text containing `<`, `&` or quotes (paths, user requests, command lines) appears literally once-escaped in both panel and trace → Task 5 step 2.

---

### Task 1: Spike — does delegation work in TrueForge local mode? (gate)

Unknowns that decide whether the rest is buildable: do dynamic subagents get the parent's MCP tools, do `thread.created`/`thread.done` arrive on the turn stream, what is the spawning system tool called.

**Files:**
- Modify: `extension/agents/coding-agent.json` (`instructions`)
- Modify: `extension/src/extension.ts` (inline-edit prompt, ~line 270)
- Modify: `extension/src/turnRunner.ts` (temporary event log, removed in Task 3)
- Modify: `docs/STATUS.md`

- [ ] **Step 1: Add the SUBAGENTS paragraph to `instructions`**, inserted before "ACT, DON'T ASK":

```
SUBAGENTS. For a multi-file task where the user did not name the files, before reading code yourself spawn exactly one dynamic subagent named "explorer". Its input must ask it to find every file that has to change (implementation, registration/wiring, tests, documentation) using repo_map, search_code, read_file and go_to_definition, and to reply with a list of paths, each with a one-line reason and the relevant line ranges. The explorer must not call propose_edit or run_terminal_command. When it reports, read the exact lines you will change and make every edit yourself. Do not spawn subagents for inline edits or single-file changes.
```

- [ ] **Step 2: Append to the inline-edit prompt** in `handleInlineEdit` (after "Do not edit other files."): ` Do not spawn subagents.`

- [ ] **Step 3: Temporary raw event log.** At the top of `handle` in `TurnController.attempt`, `console.log("[tf-event]", e.type, (e as {threadId?: string}).threadId ?? "", JSON.stringify(e).slice(0, 300))`.

- [ ] **Step 4: Live run.** Start TrueForge (`OUTBOUND_URL_ALLOWED_HOSTS='["localhost","127.0.0.1"]' npx @truefoundry/trueforge@latest`), `npm run compile`, F5, open the flask 3.1.3 checkout, run the exact Task B instruction from `docs/TASKS.md`. Read the Debug Console filtered on `[tf-event]`.

Expected: a `thread.created` with `agentInfo.name` ≈ `explorer`; `tool.response` events on the child `threadId` for `repo_map`/`search_code`/`read_file`; a `thread.done`; then the parent edits ≥3 files. Note the system tool's `toolInfo.name` from the parent's `model.message` tool call.

- [ ] **Step 5: Record findings** in `docs/STATUS.md` under a new heading `## Subagent spike (2026-11-22)`: tool name, whether child had MCP tools, whether thread events came on the turn stream, which model.

- [ ] **Step 6: Gate.** If the child had **no** MCP tools, or no `thread.*` events arrive on the turn stream, **stop and report to the user** before Task 2 — the design needs revising. Otherwise commit (keep the temporary log for now):

```bash
git add extension/agents/coding-agent.json extension/src/extension.ts extension/src/turnRunner.ts docs/STATUS.md
git commit -m "Ask the agent to delegate discovery to an explorer subagent; record spike results"
```

---

### Task 2: `ThreadRouter` + unit-test harness

**Files:**
- Create: `extension/src/threadRouter.ts`
- Create: `extension/src/test/threadRouter.test.ts`
- Modify: `extension/package.json` (script `test:unit`)

**Interfaces:**
- Produces (exported from `threadRouter.ts`):

```ts
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
export class ThreadRouter {
  constructor(sink: ThreadSink);
  handle(e: TrueForgeApi.TurnStreamingEvent): void;   // only acts on model.message(.delta) content, thread.*, compaction
  subagentName(threadId: string): string | undefined; // undefined for the root thread
}
```

Rules: the root thread is the `threadId` of the first `model.message` or `model.message.delta` seen. Any other thread id is a subagent; before its `thread.created` arrives its name is `"subagent"`. `durationMs` = `Date.parse(done.createdAt) - Date.parse(created.createdAt)`, undefined if the start was never seen. `ok` = `state.status === "done"`; `error` = `state.error` otherwise. Compaction `contextTokens`/`thresholdTokens` come from `trigger`.

- [ ] **Step 1: Add the test script** to `extension/package.json`:

```json
"test:unit": "esbuild src/test/*.test.ts --bundle --platform=node --format=cjs --outdir=out/test --external:vscode && node --test out/test/"
```

- [ ] **Step 2: Write the failing tests** in `src/test/threadRouter.test.ts` with `node:test` + `node:assert/strict`, using a recording sink and hand-built event objects (cast with `as TrueForgeApi.TurnStreamingEvent`):
  - `root deltas go to onRootDelta`: delta `{threadId:"T0", content:"hi"}` → `onRootDelta("hi")`, no subagent calls.
  - `thread.created starts a named subagent`: after a T0 delta, `thread.created {threadId:"T1", agentInfo:{name:"explorer", input:"find files", type:"dynamic"}, parent:{threadId:"T0", toolCallId:"c1"}, createdAt:"2026-11-22T10:00:00.000Z"}` → one `SubagentStart` with those values; `subagentName("T1") === "explorer"`, `subagentName("T0") === undefined`.
  - `child deltas are routed to the subagent`: delta on T1 `"x"` → `onSubagentDelta("T1","explorer","x")`, `onRootDelta` not called.
  - `unknown non-root thread is treated as a subagent`: T0 delta, then T9 delta `"leak"` with no `thread.created` → `onSubagentDelta("T9","subagent","leak")`, `onRootDelta` called only with T0's text.
  - `thread.done ok computes duration`: done for T1 at `10:00:04.500Z`, `state:{status:"done"}` → `{ok:true, durationMs:4500, name:"explorer"}`.
  - `thread.done error`: `state:{status:"error", error:"boom"}` → `{ok:false, error:"boom"}`.
  - `thread.done without start has no duration` → `durationMs === undefined`.
  - `compaction events`: started with `trigger:{contextTokens:41000, thresholdTokens:32000}` → `{phase:"started", contextTokens:41000, thresholdTokens:32000}`; finished with `durationMs:1800` → `{phase:"finished", durationMs:1800}`.

- [ ] **Step 3: Run** `cd extension && npm run test:unit` — Expected: FAIL (module not found).

- [ ] **Step 4: Implement `ThreadRouter`** in `src/threadRouter.ts` per the rules above. Import `TrueForgeApi` as a type only.

- [ ] **Step 5: Run** `npm run test:unit` — Expected: 8 passing. Then `npm run compile` — clean.

- [ ] **Step 6: Commit**

```bash
git add extension/src/threadRouter.ts extension/src/test/threadRouter.test.ts extension/package.json
git commit -m "Add ThreadRouter: classify streamed events by root vs subagent thread"
```

---

### Task 3: Wire the router into `turnRunner` and `extension.ts`

**Files:**
- Modify: `extension/src/turnRunner.ts` (`TurnCallbacks`, `attempt()`)
- Modify: `extension/src/extension.ts` (`runRequest` callbacks; line ~104 MCP listener)

**Interfaces:**
- Consumes: `ThreadRouter`, `SubagentStart`, `SubagentDone`, `CompactionInfo` (Task 2).
- Produces — `TurnCallbacks` changes:
  - `onToolCall(name: string, args: Record<string, unknown>, subagent?: string, at?: string): void` (subagent = `router.subagentName(e.threadId)`, at = `tool.response.createdAt`)
  - new optional `onSubagentStart?(s: SubagentStart)`, `onSubagentDelta?(threadId: string, name: string, text: string)`, `onSubagentDone?(d: SubagentDone)`, `onCompaction?(c: CompactionInfo)`.
  - `onDelta` is now called only for root-thread text.
- Produces — webview messages posted by `extension.ts`:
  - `{type:"tool_call", name, args, subagent?, at?}`
  - `{type:"subagent_start", threadId, name, input, at}`
  - `{type:"subagent_delta", threadId, content}`
  - `{type:"subagent_done", threadId, name, ok, error?, durationMs?, at}`
  - `{type:"compaction", phase, contextTokens, thresholdTokens, durationMs?, at}`
  - `{type:"done", …existing fields}` unchanged.

- [ ] **Step 1:** In `attempt()`, create `const router = new ThreadRouter({...})` per attempt (so a retry starts fresh), call `router.handle(e)` first in `handle`, and remove the direct `this.cb.onDelta(e.content)` from the delta case (router's `onRootDelta` → `cb.onDelta`). Pass `router.subagentName(e.threadId)` and `e.createdAt` to `onToolCall` in the `tool.response` case. Remove the Task 1 `[tf-event]` log.

- [ ] **Step 2:** In `extension.ts`, delete the `mcpServerHandle.onToolCall(...)` panel post (line ~104) and make `runRequest`'s `onToolCall` post `tool_call` with `subagent`/`at` — tool calls now come from TrueForge events, which carry the thread, so child calls are no longer shown as the main agent's. Post the four new message types from the new callbacks.

- [ ] **Step 3: Verify** `npm run compile` clean and `npm run test:unit` still 8 passing. In the Extension Development Host run Task A once: tool calls still appear in the panel; no subagent messages.

- [ ] **Step 4: Commit**

```bash
git add extension/src/turnRunner.ts extension/src/extension.ts
git commit -m "Route subagent and compaction events from TrueForge to the panel"
```

---

### Task 4: Panel — subagent cards and compaction line

**Files:**
- Modify: `extension/src/webview/agentPanel.ts` (styles + message handler in the inline script)

**Interfaces:**
- Consumes: webview messages from Task 3.
- Produces: a webview-side function `closeOpenSubagents(status: string)` used by the `done`/`run_started` handlers.

- [ ] **Step 1: Subagent card.** On `subagent_start` append a card keyed by `threadId`: header `⑂ Subagent <code>name</code> — <first line of input, ≤120 chars>` plus a `running…` badge; a body holding a streaming text area and a tool list. `subagent_delta` appends text to that body (create the card with name "subagent" if missing). `tool_call` with `subagent` set appends `name(args)` to that card's tool list instead of the main transcript. `subagent_done` sets the badge to `done in X.Xs` or `failed: <error>` and collapses the body; clicking the header toggles it.

- [ ] **Step 2: Compaction line.** On `compaction` with `phase:"finished"` append a status line `Context compacted (≈<contextTokens> tokens over the <thresholdTokens> threshold, <durationMs/1000>s)`; ignore `started` in the transcript.

- [ ] **Step 3: Close stale cards.** `closeOpenSubagents('cancelled' | 'stopped')`: on `done` mark any still-running card `cancelled` when `msg.status === "cancelled"`, else `stopped`; on `run_started` mark leftovers `stopped` (retry/fallback attempts).

- [ ] **Step 4: Verify** `npm run compile` clean; Extension Development Host, Task B: an explorer card appears, streams, lists its tool calls, ends with a duration; main transcript contains no explorer text.

- [ ] **Step 5: Commit**

```bash
git add extension/src/webview/agentPanel.ts
git commit -m "Show subagents as nested cards and compaction as a status line"
```

---

### Task 5: Rework the Agent Trace; remove the .docx write-up

**Files:**
- Modify: `extension/src/webview/agentPanel.ts` (trace code from commit `89c854a`)
- Modify: `extension/src/extension.ts` (`export_trace` handler)
- Delete: `docs/WRITEUP.docx`, `docs/build_docx.py`

**Interfaces:**
- `recordTrace(category: string, summary: string, detail?: string, at?: string)` — `criteria` parameter removed; `at` is the TrueForge `createdAt` when present, else `Date.now()`.
- Export JSON shape: `{ sessionId: string|null, model: string|null, exportedAt: string, entries: Array<{t: string /*ISO*/, category, summary, detail}> }`.

- [ ] **Step 1: Remove rubric badges.** Delete the `criteria` argument from every `recordTrace` call, the badge rendering and `.trace-badge` CSS.

- [ ] **Step 2: Fix double escaping.** `recordTrace` escapes once at render; callers pass raw strings (remove `esc(msg.path)` in the `submitEdit` call). Check by asking for a change to a file path or command containing `<b>&"` (e.g. approve `echo "<b>&"`): the trace row and panel show the characters literally, no `&amp;`.

- [ ] **Step 3: New rows.** `subagent` category: on start `explorer started — <input first line>`, on done `explorer finished in 4.5s` / `explorer failed: <error>` (detail = full input). `compaction` category for finished compactions. Tool rows from subagents read `explorer › search_code(query, path)`. Border colours: `.cat-subagent` → `var(--vscode-textLink-foreground)`, `.cat-compaction` → `var(--vscode-charts-lines)`.

- [ ] **Step 4: Session-aware export.** Track `sessionId`/`model` from the last `done` message; `traceDownload` posts the JSON shape above. `export_trace` handler unchanged except default filename stays `trueforge-trace-<ISO>.json`.

- [ ] **Step 5: Delete** `docs/WRITEUP.docx` and `docs/build_docx.py` and commit that alone (the script is 226 lines, so it gets its own commit):

```bash
git rm docs/WRITEUP.docx docs/build_docx.py
git commit -m "Remove the unused .docx write-up and its build script"
```

- [ ] **Step 6: Verify** `npm run compile` clean; run Task B, open Trace, Download JSON: file contains `sessionId`, an `explorer started` and `explorer finished` entry, no `criteria` keys.

- [ ] **Step 7: Commit**

```bash
git add extension/src/webview/agentPanel.ts extension/src/extension.ts
git commit -m "Agent Trace: record subagents and compaction, drop rubric tags, fix escaping, export session id"
```

---

### Task 6: Live verification and project docs

**Files:**
- Modify: `docs/STATUS.md`, `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`, `README.md` (Features table: one row "Subagents & trace")

- [ ] **Step 1:** Task B with the primary model: explorer card + trace rows; TrueForge UI (http://localhost:8790, the session id from the run-end line) shows the child thread; ≥3 files changed; `pytest tests/test_cli.py -q` passes; `flask config` prints masked JSON.
- [ ] **Step 2:** Task B with the fallback model set as primary — record whether it delegates. Either way the task must complete.
- [ ] **Step 3:** Task A: no `subagent_start` in the trace; diff opens; `FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"` prints `False`.
- [ ] **Step 4:** Task C (invalid primary key, valid fallback): retries then fallback; no stale "running" subagent card; `git status` clean.
- [ ] **Step 5:** Cancel while the explorer card is running: card shows `cancelled`, `git status` clean.
- [ ] **Step 6:** Update `docs/STATUS.md` (results of steps 1–5 with model names), `docs/DECISIONS.md` (why the explorer split: discovery noise stays in the child's context, the editing thread gets a compact file list; delegation is agent-decided, not hardcoded), `docs/ARCHITECTURE.md` (event flow: TrueForge → ThreadRouter → panel/trace), README row.
- [ ] **Step 7: Commit**

```bash
git add docs/STATUS.md docs/DECISIONS.md docs/ARCHITECTURE.md README.md
git commit -m "Docs: subagent delegation, thread routing and live verification results"
```

---

### Task 7: Correct the write-up (after the video is re-recorded)

The video itself is recorded by the team; this task needs its timestamps.

**Files:**
- Modify: `docs/writeup.html`; regenerate `docs/WRITEUP.pdf` from it (print to PDF, A4, via Chrome headless: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --print-to-pdf=docs/WRITEUP.pdf --no-pdf-header-footer docs/writeup.html`)

- [ ] **Step 1: §1 Team** — replace the TODO flag with every member's name, college/employer and GitHub handle (ask the user for the list).
- [ ] **Step 2: §3 and §8** — remove the false "scout/editor subagent split … fixed 2-stage pipeline hardcoded in our extension" claims; describe the agent-decided `explorer` subagent, the ThreadRouter, the panel card and Agent Trace, and compaction display. Limitations: delegation depends on the model following the instruction (state Step 2 of Task 6's result honestly).
- [ ] **Step 3: §6 Scorecard** — replace the placeholder note and timestamps with the new video's real timecodes; B4 row points at the explorer card + TrueForge child thread moment.
- [ ] **Step 4: Fit to 3 pages.** Regenerate; `pdfinfo docs/WRITEUP.pdf | grep Pages` → `Pages: 3` or fewer; `grep -c 'class="flag"' docs/writeup.html` → `0`.
- [ ] **Step 5: Commit**

```bash
git add docs/writeup.html docs/WRITEUP.pdf
git commit -m "Write-up: accurate subagent description, real scorecard timestamps, full team, 3 pages"
```
