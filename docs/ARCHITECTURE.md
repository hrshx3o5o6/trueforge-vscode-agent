# Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ VS Code Extension (extension/)                                │
│  ┌───────────────┐   ┌──────────────────┐   ┌──────────────┐ │
│  │ Webview (chat/│   │ Inline-edit       │   │ Diff/approval│ │
│  │ agent panel)  │   │ command           │   │ handler      │ │
│  └──────┬────────┘   └─────────┬─────────┘   └──────┬───────┘ │
│         └───────────────┬──────┴────────────────────┘        │
│                          ▼                                     │
│              @truefoundry/trueforge-sdk client                 │
└──────────────────────────┬────────────────────────────────────┘
                            │ HTTP + SSE (sessions, turns, events)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ TrueForge server (npx @truefoundry/trueforge@latest, local)   │
│  agent loop: model calls, tool approval, context management,  │
│  session state, streaming                                     │
└──────────────────────────┬────────────────────────────────────┘
                            │ MCP (tool calls over HTTP, registered
                            │ as a localhost connector, no auth)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Our MCP tool server (mcp-server/), running alongside the       │
│ extension, with real access to the open workspace:              │
│   repo_map · search_code · read_file · propose_edit (approval) │
│   · run_terminal_command (approval) · go_to_definition          │
└─────────────────────────────────────────────────────────────┘
```

## Why this shape, specifically
- **The agent decides what to read/edit, not our extension.** This is
  what separates us from the B4 bottom anchor ("sessions and turns only,
  editor actions handled outside the harness"). Every editor capability is
  a tool TrueForge's agent calls on its own, and TrueForge's own
  tool-approval mechanism is what drives the diff-review flow — we didn't
  build a separate approval system, we plugged into the harness's.
- **Writes never touch disk directly.** `propose_edit` returns a diff and
  is marked needs-approval; actually applying it (`vscode.workspace.applyEdit`,
  per accepted hunk) only happens after the extension's approval handler
  resolves the TrueForge approval event. This is also what makes
  cancellation trivially safe (B3/A3): if a turn is cancelled before
  approval, nothing was ever written.
- **The MCP server runs locally, no auth.** Per TrueForge's own docs, MCP
  servers are registered by URL in Settings → Connectors; ours is
  `http://localhost:<port>/mcp`, registered once at extension startup or
  via a one-time setup step documented in `docs/SETUP.md`.

## Data flow for a single agent-mode turn (Task B shape)
1. User types an instruction in the webview panel, no files named.
2. Extension calls `client.sessions.createTurnStream(session.id, { input: [...] })`.
3. TrueForge's agent loop calls our MCP tools in sequence — `repo_map` (if
   not already given this session), `search_code`, `read_file` — each
   streamed back as tool-call events the webview can render live.
4. Agent decides on 3+ files to change, calls `propose_edit` for each.
5. TrueForge pauses each on approval; extension renders a per-hunk diff.
6. User accepts/rejects per hunk; accepted hunks applied via `applyEdit`.
7. `turn.done` fires; webview shows final status.

## Key files (once built)
| Path | Responsibility |
|---|---|
| `extension/src/extension.ts` | Activation, command registration (forked skeleton) |
| `extension/src/trueforgeClient.ts` | Thin wrapper around `@truefoundry/trueforge-sdk` |
| `extension/src/webview/` | Chat/agent-mode panel (plain HTML/CSS/JS) |
| `extension/src/diffHandler.ts` | Renders tool-approval events as diffs, applies accepted hunks |
| `mcp-server/src/server.ts` | HTTP MCP server entry point |
| `mcp-server/src/tools/*.ts` | One file per tool |
