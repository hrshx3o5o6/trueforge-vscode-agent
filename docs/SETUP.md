# Setup — getting everything running locally

## 1. TrueForge server
```
npx @truefoundry/trueforge@latest
```
Verified working (2026-11-18): starts at `http://localhost:8790`, SQLite
at `~/Library/Application Support/trueforge/db/db.sqlite`, no login needed
in standalone mode. Leave this running in its own terminal/background
process — the extension and MCP server both talk to it over HTTP.

Health check: `curl http://localhost:8790/api/v1/docs` should return 200.

## 2. Configure a model provider
Open `http://localhost:8790` in a browser → Settings → Models → pick a
provider from the catalog → paste an API key → Create. **Configure a
second provider too** — needed for the Task C resilience test (B3).

Put the real keys in a local `.env` (gitignored) — never commit them.
Ship `.env.example` with placeholder values only.

## 3. The pinned task repo
```
git clone https://github.com/pallets/flask.git /tmp/flask-3.1.3
cd /tmp/flask-3.1.3
git checkout 3.1.3
```
This is the repo all 3 fixed tasks run against. Don't modify this clone's
pinned state outside of the actual task runs — re-clone fresh before
every rehearsal if in doubt.

## 4. SDK smoke test (prove the loop works before touching the extension)
```
npm i @truefoundry/trueforge-sdk
```
```ts
import { TrueForge } from '@truefoundry/trueforge-sdk';

const client = new TrueForge({ baseUrl: 'http://localhost:8790', timeoutInSeconds: 600 });

const { data: session } = await client.sessions.create({
  agent: { spec: { model: { name: '<a model you configured>' }, instructions: 'You are a concise, helpful assistant.' } },
});

const stream = await client.sessions.createTurnStream(session.id, {
  input: [{ type: 'user.message', content: 'In two sentences, what is TrueForge?' }],
});

for await (const { data: event } of stream.withMetadata()) {
  if (event.type === 'model.message.delta') process.stdout.write(event.content ?? '');
  if (event.type === 'turn.done') console.log('\n\nstatus:', event.state.status);
}
```
Run this as a plain Node script first — don't debug SDK issues inside the
VS Code extension host, it's slower to iterate.

## 5. Register our MCP server with TrueForge
Once `mcp-server/` is running (`npm run dev` inside that folder, default
port TBD — update this doc once decided):
- TrueForge UI → Settings → Connectors → Add MCP Server → `http://localhost:<port>/mcp`, auth: none.
- Mark `propose_edit` and `run_terminal_command` as needing approval
  (Settings → Connectors → the server → tool approval config).

## 6. Load the extension in VS Code
```
cd extension
npm install   # or pnpm/bun depending on what the fork's lockfile ends up using
npm run build
```
Then `F5` in VS Code (or Run → Start Debugging) to launch the Extension
Development Host with `pallets/flask` open as the workspace.

## Known gaps in this doc (update as we go)
- [ ] Exact MCP server port/path once `mcp-server/` has a real entry point
- [ ] Whether TrueForge has an API to register an MCP connector
      programmatically (would avoid a manual UI step on every clean setup)
      — check `trueforge.dev/api-reference` for a connectors endpoint
- [ ] Exact build tool for `extension/` (fork uses esbuild + its own
      `script/`; confirm it still works after our changes)
