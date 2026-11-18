# TrueForge VS Code Agent — Techfest 2026-27 Forge-a-thon

A VS Code coding-agent extension whose agent loop runs entirely on
[TrueForge](https://github.com/truefoundry/trueforge) (TrueFoundry's
open-source agent harness) — built for the **2nd Techfest Forge-a-thon**
(Round 1 deadline: **20 November 2026, 23:59 IST**).

**Team:** dihhbug (see `docs/TEAM.md`)

## What this is
Editor capabilities (read/search file, propose an edit, run a command) are
exposed to the agent as **MCP tools**, not handled secretly inside the
extension. TrueForge runs the actual tool loop — model calls, streaming,
tool approval, context management. Our extension is a thin client: it opens
sessions, streams turns, and renders TrueForge's events (diffs, tool calls,
approvals) inside the editor.

## Fork declaration (required by the rules)
- **Upstream:** [`sst/opencode`](https://github.com/sst/opencode), subdirectory `sdks/vscode/`
- **Commit:** `521ceac004e59fbbfca0929596107cd8430f2b26` (2026-11-18)
- **Upstream licence:** MIT — preserved at `LICENSE-UPSTREAM-OPENCODE`, this repo's own new code is also MIT (`LICENSE`)
- **Why this base, not a fuller community fork:** the official `sst/opencode` VS Code extension is a thin terminal launcher (no webview, no diff UI) — we build the webview/diff/approval UI ourselves on top of its extension-activation scaffolding. A fuller community fork (`opencode-harness`) had no clear LICENSE file, which was a risk not worth taking under deadline pressure. See `docs/DECISIONS.md`.

## Repository layout
```
extension/      the VS Code extension (forked skeleton + our additions)
mcp-server/     our local MCP tool server (read/search/propose_edit/run_command)
docs/           the full technical plan — START HERE if you're new to this repo
```

## Start here if you're picking this up
1. Read `docs/PLAN.md` — the full build plan, mapped to the competition's scoring criteria
2. Read `docs/ARCHITECTURE.md` — how the pieces actually connect
3. Read `docs/CONTEXT_STRATEGY.md` — the context-assembly design (our biggest differentiator)
4. Read `docs/SETUP.md` — how to get TrueForge + the extension running locally
5. Check `docs/STATUS.md` for what's done vs. not yet started

## Competition
- Pinned task repo: `pallets/flask` @ tag `3.1.3`
- 3 fixed tasks (A, B, C) — see `docs/TASKS.md` for exact wording and verification steps
- Full scoring breakdown: `docs/SCORING_MAP.md`
