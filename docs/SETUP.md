# Setup — getting everything running locally

## 1. TrueForge server
```
npx @truefoundry/trueforge@latest
```
Verified working (2026-11-18): starts at `http://localhost:8790`, SQLite
at `~/Library/Application Support/trueforge/db/db.sqlite`, no login needed
in standalone mode. Leave this running in its own terminal/background
process — the extension talks to it over HTTP.

Health check: `curl http://localhost:8790/api/v1/docs` should return 200.

## 2. Configure a model provider
Open `http://localhost:8790` in a browser → Settings → Models → pick a
provider from the catalog → paste an API key → Create. **Configure a
second provider too** — needed for the Task C resilience test (B3).

This is a manual, one-time step involving a real secret — do it yourself
in the TrueForge UI, never via chat or a script. **Not done yet as of
this doc's last update** — see `docs/STATUS.md`.

## 3. The pinned task repo
```
git clone https://github.com/pallets/flask.git /tmp/flask-3.1.3
cd /tmp/flask-3.1.3
git checkout 3.1.3
```
This is the repo all 3 fixed tasks run against, and the workspace you
should open in the Extension Development Host (step 5). Don't modify
this clone's pinned state outside of actual task runs — re-clone fresh
before every rehearsal if in doubt.

## 4. Build and load the extension
The MCP tool server is NOT a separate process — it lives inside the
extension (`extension/src/mcpServer/`) and starts automatically when the
extension activates. There is nothing to run standalone.

```
cd extension
npm install
npm run compile        # one-shot build, or:
npm run watch:esbuild  # rebuilds on save while you iterate
```
Then open the `extension/` folder in VS Code and press `F5` (Run → Start
Debugging) — this launches a new "Extension Development Host" window
with our extension loaded. In that new window, open `/tmp/flask-3.1.3`
(from step 3) as the workspace folder.

Verified as of 2026-11-18: `npm install`, `npx tsc --noEmit`, `npx eslint
src`, and `node esbuild.js` all pass clean and produce a working
`dist/extension.js`. **Not yet verified: actually pressing F5 and using
it** — see `docs/STATUS.md`'s gap list.

## 5. Configure the extension's settings
In the Extension Development Host window, open Settings and search
`trueforgeAgent` (or edit `.vscode/settings.json` in the flask workspace),
and set:
- `trueforgeAgent.baseUrl` — default `http://localhost:8790`, only change
  if TrueForge is running elsewhere
- `trueforgeAgent.primaryModel` — the exact model name as configured in
  TrueForge Settings → Models (e.g. `anthropic/claude-sonnet-4-6`)
- `trueforgeAgent.fallbackModel` — a second model name, for the Task C
  resilience test (B3). Leave blank to disable fallback.
- `trueforgeAgent.mcpServerPort` — default `4790`, only change if that
  port is taken

Without `primaryModel` set, both commands below show an error instead of
silently doing nothing.

## 6. Register our MCP server with TrueForge
On activation the extension prints the exact URL to the status bar (also
visible via `http://127.0.0.1:<mcpServerPort>/mcp`, default
`http://127.0.0.1:4790/mcp`). In the TrueForge UI: Settings → Connectors
→ Add MCP Server → paste that URL, auth: none.

**No per-tool "needs approval" configuration here** — unlike the
original plan, human review for `propose_edit`/`run_terminal_command` is
handled entirely by our own code (`approvalRegistry.ts`), not a
TrueForge-native setting. See `docs/DECISIONS.md`'s "Human approval is
our OWN in-process gate" entry for why.

## 7. Use it
- Command palette → "TrueForge Agent: Open Panel" — opens the chat
  webview (agent mode, A2/A3/B1-B4's home)
- Select code in the editor → Cmd+K (or right-click → "TrueForge Agent:
  Inline Edit Selection") — single-file inline edit (A1)
- Any `propose_edit`/`run_terminal_command` call pauses and shows a
  review card in the panel — accept/reject per hunk (or run/deny for
  commands) before anything touches disk

## Known gaps in this doc (update as we go)
- [ ] Nobody has actually done steps 4-7 yet end to end — see
      `docs/STATUS.md` for the exact "first real run" checklist and what
      to watch for when it happens.
- [ ] Whether TrueForge has an API to register an MCP connector
      programmatically (would avoid the manual UI step in step 6 on every
      clean setup) — check `trueforge.dev/api-reference` for a
      connectors endpoint; not checked yet.
- [ ] Exact `model.message.delta` / `tool.call` / `turn.done` event field
      names used in `resilience.ts` and `extension.ts` are read directly
      from the SDK's own `reference.md`, but never seen fire in a real
      turn — confirm on the first real run.
