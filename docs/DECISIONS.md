# Decisions log

Record of real choices made and why, so nobody re-litigates them under
deadline pressure or silently reverses one without knowing the reasoning.

## Fork base: official `sst/opencode`, not a fuller community fork
Considered `K-Arthur/opencode-harness` — architecturally a much closer
match to what we need (webview, DiffHandler, multi-tab, checkpoint-based
undo, already built). **Rejected** because it has no visible LICENSE file
at the repo root — under 2 days to the Round 1 deadline, a licence
ambiguity is not a risk worth taking, especially since the competition
rules require preserving the upstream licence exactly and make a licence
violation an eligibility failure. The official `sst/opencode` repo is
unambiguously MIT. Its VS Code extension is thin (terminal launcher only,
no webview/diff UI) — we accept the extra build work in exchange for zero
licensing risk. See README.md for the exact commit pinned.

## No framework in the webview
Plain HTML/CSS/JS, no React/Vue. Smaller bundle, nothing to debug besides
our own code, and the webview UI itself scores zero points directly — all
the scored behaviour is about what it *shows* (diffs, streaming, tool
calls), not how it's built. Don't spend hackathon time on this.

## Context assembly: tools + budgets, not pre-retrieval
Full reasoning in `docs/CONTEXT_STRATEGY.md`. The short version: we give
the agent bounded tools (`repo_map`, `search_code`, `read_file`,
`go_to_definition`) and let its own tool-loop decide what to fetch, rather
than our extension guessing relevance up front. This is both the better
engineering answer and the literal reading of "agent mode... finding them
is the agent's job."

## Don't overfit prompts/behaviour to one model
The brief explicitly warns: *"the organisers may ask any shortlisted team
to repeat a fixed task live with a model of the organisers' choice."*
Write agent instructions and tool descriptions in plain, model-agnostic
language. Test with at least 2 different providers before submitting, not
just whichever model happens to produce the prettiest demo.

## Resilience target: automatic fallback, not just a clean error
B3's top anchor (10/10) requires automatic fallback to a second configured
model with zero user action. The mid-tier anchor (7/10, retry+backoff then
error) is much more common among time-pressured teams — we're explicitly
going for the top anchor because it's a real but bounded amount of extra
work, and most competitors won't do it.

## What we are NOT building (scope control under 2 days)
- No sandbox integration (Daytona) — not required for any fixed task.
- No skills (`SKILL.md` packs) — optional, not scored unless we have
  spare time after everything above is solid.
- No Code Mode / deferred tool loading beyond the subagent split, unless
  time permits after Phases 0-7 in `docs/PLAN.md` are done.
- No VS Code Marketplace publishing — explicitly out of scope per the brief.

## MCP server runs INSIDE the extension host, not as a standalone process
Originally planned `mcp-server/` as a separate top-level Node project. Corrected
after realizing `go_to_definition` and real symbol extraction need
`vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', ...)`
and `'vscode.executeDefinitionProvider'` — APIs that only exist inside the VS
Code extension host process, not in a standalone Node script. Moved the MCP
server to `extension/src/mcpServer/`: it starts an HTTP+MCP transport server
from within `extension.ts`'s `activate()`, using `vscode.*` APIs directly for
anything editor-aware, and plain Node `fs`/`child_process` (ripgrep) for
everything else. This also simplifies the "run from a clean clone" story —
one `F5` launches the UI and the tool server together, no second process to
manage or document separately.

## Human approval is TrueForge-native; our gate is only a fallback (corrected 2026-11-20)
The earlier entry here claimed the SDK has no approval concept. That was
wrong: `McpServer.requireApprovalForTools`, the `tool.approval_required`
event and the `user.tool_approval` input all exist. Now
`agents/coding-agent.json` marks `propose_edit` and `run_terminal_command`
as approval-required. When TrueForge pauses, `turnRunner.ts` rebuilds the
call's arguments from the streamed deltas, the extension renders the
per-hunk review (and VS Code's diff editor), records the hunk selection
(`approvalRegistry.recordEditDecision`), and posts allow/deny back to the
turn. When TrueForge then calls the tool, the MCP handler applies exactly
the recorded hunks. If no decision was recorded (approval not configured
on the server), the handler falls back to the old in-process gate, so a
write still never happens without a human decision.

## The agent spec must attach the MCP server (fixed 2026-11-20)
Registering a connector in TrueForge does not give a session tools.
`spec.mcpServers: [{ name }]` is required, and an unknown name fails
session creation with HTTP 422. The extension now also registers/updates
the connector itself (`trueforgeSetup.ts`) with a per-activation bearer
token, because the MCP server can edit files and run commands.

## Tools are preloaded, not deferred
TrueForge's deferred tool discovery (`preload: false`, the default) failed
in local mode during testing: the model's `list_tools` call returned
"MCP server 'deferred-tools' not found". Six small schemas are cheap, so
we preload them. Context-engineering features we do use: compaction,
large-tool-response offload, dynamic subagents (all in the agent
definition), plus our own pre-turn context assembly.

## Discovery is delegated to an explorer subagent, by the agent (2026-11-22)
`dynamicSubAgents` was enabled from the start, but nothing asked the agent
to use it and nothing showed it. The instructions now tell the agent, for
multi-file tasks where no files are named, to start one dynamic subagent
named `explorer` through TrueForge's `create_sub_agent` tool and to make
every edit itself. Why: discovery is the noisy part (many searches, long
file reads), and it now stays in the child's context; the editing thread
gets back a compact file list with reasons. It is the agent's decision,
not a pipeline hardcoded in the extension, so a model that skips it still
completes the task. Inline edits are told never to delegate, to keep
Task A fast. Verified live: the child thread gets our MCP tools, and
`thread.created`/`thread.done` arrive on the turn stream (see STATUS.md).
Tool calls in the panel are now reported from TrueForge's `tool.response`
events, not by the MCP server, because only those say which thread made
the call.

## Edits are saved, journaled and roll back as a unit
`WorkspaceEdit` alone only changes the in-memory document, so `pytest` in
a terminal saw the old file. Every applied change is now saved and
recorded in `editJournal.ts`, which powers the per-change Undo button and
whole-run rollback on cancel, failure or retry. A cancelled multi-file
run therefore never leaves half-applied edits behind.

## Resilience: watchdog → retry with backoff → fallback
`turnRunner.ts` treats a thrown SDK error, `turn.done` with
`state.status: "error"`, or no event for `stallTimeoutSeconds` (while not
waiting on the user) as a failed attempt. It retries the primary model
`maxRetries` times (1s, 2s, 4s…) in the same session, then falls back
automatically to `fallbackModel` in a new session. A session's model is
fixed at creation, so chat history is lost only on that path.
