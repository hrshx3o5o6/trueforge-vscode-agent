# Status — what's done, what's not, who owns what

Update this file as work happens. This is the fastest way for a new
teammate to know what's real vs. planned.

## Done (verified, not just written)
- [x] TrueForge server running locally at `http://localhost:8790`
      (verified 2026-11-18, standalone mode, SQLite, health check OK)
- [x] Fork base copied in from `sst/opencode` @ `521ceac004e59fbbfca0929596107cd8430f2b26`
- [x] Repo scaffolded with full planning docs
- [x] **MCP tool server implemented** (`extension/src/mcpServer/`): all 6
      tools coded — `repo_map`, `search_code`, `read_file`, `propose_edit`
      (+ per-hunk reconstruction), `run_terminal_command`, `go_to_definition`
- [x] **Extension wiring implemented** (`extension/src/extension.ts`):
      starts the MCP server on activate, registers `openPanel` +
      `inlineEdit` commands, configuration schema in `package.json`
- [x] **Resilience wrapper implemented** (`resilience.ts`): automatic
      fallback to a second model on turn failure
- [x] **Webview panel implemented** (`webview/agentPanel.ts`): plain
      HTML/CSS/JS chat UI, streams deltas/tool-calls, cancel button
- [x] `npm install` succeeds, `npx tsc --noEmit` passes clean, `node
      esbuild.js` produces a working `dist/extension.js` bundle
      (verified 2026-11-18)

## NOT yet verified (compiles ≠ works — be honest about this gap)
- [ ] **Never run inside a real Extension Development Host.** All of the
      above is confirmed to compile and bundle, but nobody has pressed F5
      and actually clicked a button yet. This is the single most
      important next step — do this before building anything else.
- [ ] **Never run against a real TrueForge turn.** No model provider has
      been configured in TrueForge yet (needs a real API key — do this
      manually in the TrueForge UI at localhost:8790, never via chat/vault).
      Until this happens, we don't know if the event shapes assumed in
      `resilience.ts` (`model.message.delta`, `tool.call`, `turn.done`
      `state.status` values) match what the SDK actually sends — these are
      documented as explicit assumptions in the code comments and in
      `docs/SETUP.md` "known gaps."
- [ ] **MCP server never registered with TrueForge.** Settings ->
      Connectors -> Add MCP Server -> `http://127.0.0.1:4790/mcp` (no
      auth) is still a manual step nobody has done.
- [ ] **Diff review / approval-event wiring (Phase 3) not started.**
      `propose_edit` computes diffs correctly in isolation, but nothing
      listens for TrueForge's tool-approval event yet, and
      `applyApprovedContent`/`reconstructContentFromAcceptedHunks` in
      `proposeEdit.ts` are not called from anywhere — they're ready to be
      wired up, not wired up.
- [ ] **Cancellation is best-effort only right now** — `extension.ts`
      stops processing events locally on Cancel, but does not actually
      abort the underlying TrueForge stream/turn server-side. Needs a
      real cancel API call once confirmed in the SDK reference.
- [ ] Task A/B/C rehearsal — can't start until the above works end-to-end
- [ ] Demo video
- [ ] Write-up PDF

## Immediate next step for whoever picks this up
1. Configure a model provider in TrueForge (localhost:8790 UI, needs a
   real API key — do this yourself, don't paste a key into chat).
2. `cd extension && npm run watch:esbuild` in one terminal.
3. Open this repo's `extension/` folder in VS Code, press F5.
4. In the new Extension Development Host window, open the `pallets/flask`
   clone as the workspace, run "TrueForge Agent: Open Panel", and send a
   real message. **This first real run will almost certainly surface bugs**
   in the untested assumptions above — expect to spend time here before
   touching Phase 3.

## Ownership
_(fill in once the team divides work — suggested split below, not fixed)_
- MCP tool server (`extension/src/mcpServer/`): built, needs runtime testing — ?
- Extension webview + diff UI: wiring done, diff/approval handler (Phase 3) not started — ?
- TrueForge agent/model config + resilience (Task C): code written, untested against a real server — ?
- Write-up + video: not started — ?

## Deadline
**Round 1 submission: 20 November 2026, 23:59 IST.** Today is 18 November.
Given the timeline, prioritize ruthlessly per `docs/PLAN.md`'s phase order
— Phase 0-4 are non-negotiable; Phase 6 (subagent split) is valuable but
cuttable if time runs out; a working, rehearsed Phase 7 demo matters more
than a perfect Phase 6.
