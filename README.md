# TrueForge VS Code Agent — Techfest 2026-27 Forge-a-thon

A VS Code coding agent whose agent loop runs entirely on
[TrueForge](https://github.com/truefoundry/trueforge). The extension is a
TrueForge client: it creates sessions and streams turns through
`@truefoundry/trueforge-sdk`, and exposes the editor (repo map, search,
file reading, go-to-definition, reviewed edits, approved commands) to the
agent as **MCP tools**. The agent, not the extension, decides what to read
and change. The extension never calls a model provider directly.

**Team:** dihhbug (see `docs/TEAM.md`)

## Features
| Capability | How |
|---|---|
| Inline edit | Select code → `Cmd/Ctrl+K` → type an instruction. The proposal opens in VS Code's diff editor and as per-hunk cards in the panel; accept/reject each hunk. |
| Agent mode | `Cmd/Ctrl+L` opens the panel. One request drives a TrueForge tool loop (`repo_map`, `search_code`, `read_file`, `go_to_definition`, `propose_edit`, `run_terminal_command`) until done. |
| Context assembly | `@path/to/file` and `@symbol` mentions, plus automatic retrieval ranked by IDF/BM25 with source/test/doc slots, under a token budget. The panel lists every file chosen and why. See `docs/CONTEXT_STRATEGY.md`. |
| Diff review | `propose_edit`/`run_terminal_command` require **TrueForge-native tool approval**. The extension answers `tool.approval_required` from the per-hunk review. Nothing is written before approval; applied changes are saved and each has an **Undo** button (Ctrl+Z also works). |
| Streaming & cancel | Tokens stream from `model.message.delta`. Cancel (button or `Cmd/Ctrl+Shift+Backspace`) aborts the stream, calls `sessions.cancel`, and rolls back every edit applied in that run. |
| Subagents & Agent Trace | For multi-file tasks the agent delegates discovery to a TrueForge dynamic subagent (`explorer`), shown as its own card with its tool calls and duration, and as a child thread in the TrueForge session. A timestamped Agent Trace (toggle **Trace**) records tool calls by thread, subagents, compaction, approvals and retries, and exports as JSON with the session id. |
| Resilience | Stall watchdog → retry with exponential backoff → automatic fallback to a second model. A failed run is rolled back and reported clearly. |

## Setup from a clean clone
Prerequisites: Node 20+, VS Code ≥ 1.94, git, Python 3.9+ (for the Flask tasks).

**1. Start TrueForge in local mode** (leave it running). The allow-list is
required: TrueForge's SSRF guard otherwise refuses to connect to the
extension's MCP server on `127.0.0.1`.
```bash
OUTBOUND_URL_ALLOWED_HOSTS='["localhost","127.0.0.1"]' npx @truefoundry/trueforge@latest
```

**2. Configure models in TrueForge.** Open http://localhost:8790 →
Settings → Models, add a provider and its key there (keys never go in this
repo). Add a second model for automatic fallback. List the exact names with
`curl -s localhost:8790/api/v1/models`.

**3. Get the pinned task repository.**
```bash
git clone https://github.com/pallets/flask.git && cd flask && git checkout 3.1.3
python3 -m venv .venv && . .venv/bin/activate
pip install -e . pytest==8.4.2 asgiref greenlet python-dotenv   # newer pytest breaks Flask 3.1.3's tests
```

**4. Build and launch the extension.**
```bash
cd extension && npm install && npm run compile
code .          # then press F5 → "Extension Development Host"
```
In the new window, open the `flask` folder.

**5. Point the extension at your models.** Copy
[`config/vscode-settings.example.json`](config/vscode-settings.example.json)
into `flask/.vscode/settings.json` and set `trueforgeAgent.primaryModel` /
`trueforgeAgent.fallbackModel` to names from step 2.

**6. Done.** The agent definition is loaded from
[`extension/agents/coding-agent.json`](extension/agents/coding-agent.json),
and the extension registers its own MCP connector with TrueForge on startup,
with a fresh bearer token each time. The status bar says
*"TrueForge Agent: tools connected"*. If it can't, an error tells you the
exact fix.

## Agent definition and model configuration
- Agent definition (committed): `extension/agents/coding-agent.json`:
  instructions, MCP server attachment, approval-gated tools, compaction,
  large-tool-response offload, dynamic subagents.
- Example model configuration: `config/vscode-settings.example.json`.
  Any model TrueForge can serve works. Nothing is provider-specific.

## Fork declaration
- **Upstream:** [`sst/opencode`](https://github.com/sst/opencode), subdirectory `sdks/vscode/`
- **Commit:** `521ceac004e59fbbfca0929596107cd8430f2b26` (2026-11-18)
- **Licence:** MIT, preserved at `LICENSE-UPSTREAM-OPENCODE`. Our own code is MIT (`LICENSE`).
- **What we kept:** the extension activation scaffolding, build config
  (esbuild/eslint/tsconfig) and packaging scripts.
- **What we changed and why:** upstream is a terminal launcher with no agent
  loop of its own, so there was no loop to replace. Everything else is new:
  the TrueForge client and turn runner, the MCP tool server, the
  approval-driven diff review, context assembly, the edit journal
  (undo/rollback), and the webview. See `docs/DECISIONS.md` and the git
  history from the first commit.

## Repository layout
```
extension/agents/            TrueForge agent definition (JSON)
extension/src/extension.ts   activation, commands, run orchestration
extension/src/turnRunner.ts  streaming, approvals, cancel, retry/backoff, fallback
extension/src/contextAssembler.ts   @-mentions + budgeted auto-retrieval
extension/src/trueforgeSetup.ts     auto-registers the MCP connector
extension/src/diffPreview.ts        proposed change in VS Code's diff editor
extension/src/mcpServer/     MCP tool server (runs inside the extension host)
extension/src/webview/       agent panel (plain HTML/CSS/JS)
config/                      example model configuration
docs/                        architecture, context strategy, decisions, tasks
```

## Competition
- Pinned task repo: `pallets/flask` @ tag `3.1.3` (commit `22d92470`)
- Fixed tasks A/B/C and verification steps: `docs/TASKS.md`
- Scoring map: `docs/SCORING_MAP.md`
