# Visible subagents + harness-level Agent Trace — design

Date: 2026-11-22 · Branch: `feature/subagents` (from `origin/feature/agent-trace`)

## Intent and why
The Round 1 deadline moved, and the goal is the **Round 1 score**. Every
criterion is at or near its top anchor except **B4 (TrueForge integration
depth)**, which sits at 7/10. The 10 anchor needs "meaningful use of at least
one context-engineering feature (subagents, …) explained in the write-up and
**visible in the session**". Today `dynamicSubAgents.enabled: true` is set in
`extension/agents/coding-agent.json` and the write-up claims it, but:

1. the instructions never ask the agent to delegate, so it likely never does;
2. `turnRunner.ts` ignores `thread.created`, `thread.done` and
   `thread.context_compaction_*`;
3. a child thread's `model.message.delta` would be streamed into the main
   transcript, interleaved with the parent's text (no `threadId` filter).

Harsha's `feature/agent-trace` adds a timestamped, exportable trace panel, but
it only re-logs what the panel already shows, so the harness activity that
matters (subagents, compaction) is missing from it.

## Goals
- Task B reliably spawns a dynamic subagent that does repository discovery,
  visible in **three places**: the agent panel, the Agent Trace, and the
  TrueForge session UI (child thread).
- Child-thread output is shown attributed to the subagent, never mixed into
  the main answer.
- Compaction, when it happens, is shown (panel status line + trace row).
- The Agent Trace records harness events from `turnRunner` (with TrueForge's
  own `createdAt` timestamps and durations), not just UI echoes.
- Write-up and scorecard updated; video re-recorded so B4 is claimable at 10.

## Non-goals
- No new capabilities outside the rubric (no new tools, no Code Mode, no skills).
- No change to context assembly, diff review, resilience logic.
- Not forcing compaction to occur during the demo.

## Anti-goals (failure even if it "works")
- Task A (inline edit) gets slower or less reliable — organisers repeat Task A
  live with a model they choose. **Inline edit must never spawn subagents.**
- Task B breaks when a model ignores the delegation instruction. Delegation is
  an improvement, not a dependency: without it the run must still succeed.
- Trace rows tagged with rubric codes (`A2`, `B4`…) — reads as gaming the rubric.
- Any regression to cancel/rollback: cancelling while a subagent runs must
  leave the workspace clean exactly as today.

## Approaches considered
- **A. Real, visible subagents + trace driven by harness events** — *chosen.*
  Builds on config already enabled and on Harsha's branch; strongest B4 claim.
- B. Surface compaction only — compaction may never trigger in Task B, so it
  may not be visible on screen; unreliable for points.
- C. Skills instead of subagents — untested in TrueForge local mode (deferred
  tool loading already failed there); riskier.

## Design

### 1. Agent definition (`extension/agents/coding-agent.json`)
Add a SUBAGENTS paragraph to `instructions`, roughly:
> For a multi-file task where the user did not name the files, first spawn one
> dynamic subagent named `explorer` whose input asks it to find every file that
> must change (implementation, registration/wiring, tests, docs) using
> repo_map/search_code/read_file/go_to_definition, and to return a list of
> paths with one-line reasons and the relevant line ranges. The explorer must
> not call propose_edit or run_terminal_command. Make all edits yourself after
> it reports. Do not spawn subagents for inline edits or single-file changes.

The inline-edit prompt in `extension.ts` additionally says "Do not spawn
subagents." Keep `dynamicSubAgents.enabled: true`.

### 2. `turnRunner.ts` — handle thread events
New optional callbacks on `TurnCallbacks`:
- `onSubagentStart({ threadId, name, input, parentThreadId, createdAt })` from
  `thread.created` (`agentInfo.name`, `agentInfo.input`, `parent.threadId`).
- `onSubagentDone({ threadId, title, ok, message?, createdAt, durationMs })`
  from `thread.done` (duration = done.createdAt − created.createdAt).
- `onCompaction({ threadId, phase: "started"|"finished", contextTokens,
  thresholdTokens, durationMs?, createdAt })`.
- `onToolCall` gains `threadId` (from the `tool.response` / message's thread)
  so tool calls can be attributed to the subagent.

Main-thread identification: the first `model.message` thread seen in the turn
that is **not** the `threadId` of any `thread.created` event is the root.
`onDelta` is called only for root-thread deltas; child deltas go to a new
`onSubagentDelta(threadId, text)`.

Approvals from child threads keep working unchanged (`answerApproval` already
uses the event's `threadId`). Cancel needs no change: `sessions.cancel` is
session-wide.

### 3. Panel (`webview/agentPanel.ts`) + `extension.ts` wiring
- New messages: `subagent_start`, `subagent_delta`, `subagent_done`,
  `compaction`, and `tool_call` carries an optional `subagent` name.
- `subagent_start` renders a nested, collapsible card: "⑂ Subagent
  `explorer` — <first line of input>", with a live-streaming body for its
  deltas and its tool calls listed inside the card. `subagent_done` marks it
  done with duration and collapses the body (expandable).
- `compaction` renders one status line ("Context compacted: 41k → threshold
  32k, 1.8s").

### 4. Agent Trace (rework of Harsha's commit)
- Keep the panel, toggle, row style, Download JSON, `export_trace` handler.
- **Remove** the rubric criteria badges and the `criteria` field.
- **Fix** double escaping (`esc(msg.path)` passed into `recordTrace`, which
  escapes again).
- New categories `subagent` and `compaction`; rows for subagent start/done
  (with duration) and compaction (with token counts). Tool rows show which
  thread made the call ("explorer › search_code(...)").
- Rows use the TrueForge event `createdAt` when the message carries it,
  falling back to `Date.now()`.
- Exported JSON gains `sessionId` and `model` at the top level so it can be
  matched to the TrueForge session.
- Remove `docs/WRITEUP.docx` and `docs/build_docx.py` (team confirmed they
  are not the write-up source).

### 5. Docs and submission
- `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`: subagent split and why
  (exploration noise stays in the child's context; the parent receives a
  compact file list → less context used by the editing thread).
- Write-up fixes found during review of `docs/WRITEUP.pdf` (all cost C2 points today):
  - It claims a "scout/editor subagent split … visible in the TrueForge
    session" and, in limitations, a "fixed 2-stage pipeline hardcoded in our
    extension". **No such code exists.** Rewrite §3 and §8 to describe what
    this branch actually builds (agent-decided dynamic subagent).
  - The scorecard says "placeholders … replace with the actual video's
    timecodes before submitting" — fill in real timestamps from the new video.
  - It is **4 pages**; the brief requires 1–3. Cut to 3.
- Write-up §3 and the scorecard row for B4 updated; new video timestamps.
- `docs/STATUS.md`: verification results.

## Verification (must be shown, not assumed)
1. `tsc --noEmit`, `eslint src`, build clean.
2. Live Task B against TrueForge local mode: `thread.created` arrives,
   explorer card appears, TrueForge UI shows the child thread, ≥3 files edited,
   `pytest tests/test_cli.py -q` passes.
3. Same with the fallback model, to check delegation isn't one-model-only.
4. Task A: no subagent spawned, timing unchanged.
5. Cancel during the explorer phase: `git status` clean.
6. Trace export JSON contains subagent rows and session id.

## Risks / unknowns for the builder to settle early (spike first)
- **Do dynamic subagents inherit the parent's MCP servers?** If not, the
  explorer has no tools. Check by a live run before any UI work; if they don't,
  check whether the system tool's arguments allow tools/MCP, else fall back to
  the explorer using only what it can and document the limitation.
- Exact system tool name for spawning (from `TrueFoundrySystemToolInfo.name`)
  — log it, show it in the trace.
- Whether `thread.created` arrives on the turn stream (vs. session stream
  only). If only the latter, subscribe to session events for the turn.

## Left to the builder
Card styling details, exact instruction wording (tested against both models),
and how child tool calls are attributed when `tool.response` lacks a threadId.
