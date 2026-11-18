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

## Human approval is our OWN in-process gate, not a TrueForge-native event
The original Phase 3 plan assumed TrueForge exposes some "tool needs
approval" event we'd listen for and resolve. Checked the installed SDK's
own `reference.md` directly (not assumed) before building anything —
no such concept exists in this version. Rather than block on an
unconfirmed API or guess at one, `propose_edit`/`run_terminal_command`'s
tool handlers (in `mcpServer.ts`) just don't resolve their own async
function until the user acts in the webview — a normal, supported way to
run a long-lived MCP tool call. `approvalRegistry.ts` holds the pending
promise resolvers; `extension.ts` relays the webview's decision back into
it. This needed zero unconfirmed TrueForge API surface, gives exact
per-hunk granularity (not just per-file), and is simpler than the
alternative we'd planned around.
