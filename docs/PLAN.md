# The build plan, mapped to scoring

This is the single most important doc for a new teammate: it ties every
piece of work directly to a scoring line item, so nothing gets built that
doesn't earn points, and nothing that earns points gets missed.

Full competition brief: see the original PDF (ask Harsha / check Drive) or
`docs/SCORING_MAP.md` for the condensed table. `docs/TASKS.md` has the exact
wording of the 3 fixed tasks we must demo.

## Why "fork opencode, swap the loop" is the whole shape of this project
Every team in this competition will fork *some* editor extension and wire
up TrueForge. That part is the floor, not the differentiator (the brief
says so explicitly: "mandatory... this is the floor, not the contest").
Where submissions actually separate is:
1. **How well context assembly is designed** (B1, 15 pts — the single
   biggest line item and explicitly called "the intellectual core")
2. **Whether editor actions are genuinely exposed as MCP tools** the agent
   calls itself, vs. secretly handled in our own extension code (B4)
3. **Real resilience** (B3 / Task C) — most teams will stop at "clear error
   message"; automatic model fallback is the top anchor and cheap relative
   to how rarely competitors will bother
4. **Honest, specific presentation** (C1/C2) — free points most rushed
   teams leave on the table

See `docs/CONTEXT_STRATEGY.md` for the full design of (1) and (2) together.

## Build order (do these roughly in this order)

### Phase 0 — environment (today)
- [ ] `npx @truefoundry/trueforge@latest` running locally at `http://localhost:8790`
- [ ] At least one model provider configured in TrueForge Settings → Models
- [ ] SDK smoke test passes: `client.sessions.create` + `createTurnStream` prints streamed tokens (see `docs/SETUP.md`)
- [ ] `pallets/flask` @ tag `3.1.3` cloned locally as the fixed test repo

### Phase 1 — MCP tool server (`mcp-server/`)
The core engineering piece. Build and unit-test in isolation before wiring
the extension to it. Tools, in priority order:
- [ ] `repo_map()` — directory tree + top-level symbols per file, ≤4k tokens, cached, invalidated on file save
- [ ] `search_code(query, path_glob?)` — ripgrep-backed, ≤20 results, ≤300 chars/snippet
- [ ] `read_file(path, range?)` — outline-only without a range; ≤200 lines with one
- [ ] `propose_edit(path, diff)` — marked **needs approval** in TrueForge; never writes directly
- [ ] `run_terminal_command(cmd)` — also approval-gated
- [ ] `go_to_definition(symbol)` — wraps `vscode.executeDefinitionProvider` (nice-to-have, strong B1/B4 signal)
- [ ] Register this server with TrueForge (Settings → Connectors → Add MCP Server, localhost URL, no auth)

### Phase 2 — extension skeleton (`extension/`)
- [ ] Strip anything in the forked `extension.ts` that assumes the `opencode` CLI/server
- [ ] Add `@truefoundry/trueforge-sdk` dependency; wire a basic session+turn call (prove the SDK loop end-to-end inside the extension, not just in a standalone script)
- [ ] Webview panel for agent-mode chat (reuse VS Code's built-in webview APIs; keep it plain HTML/CSS/JS per `docs/DECISIONS.md` — no framework needed for an MVP)
- [ ] Inline-edit command: selection → instruction prompt → single-turn session → diff rendering

### Phase 3 — diff review + undo (B2) — IMPLEMENTED 2026-11-18
- [x] Render `propose_edit` as a per-hunk diff view — done via our own
      in-process approval gate (`approvalRegistry.ts`), not a TrueForge-
      native approval event (none exists in the installed SDK — see
      `docs/DECISIONS.md`)
- [x] Accept/reject per hunk; only accepted hunks go through
      `vscode.workspace.applyEdit` (`reconstructContentFromAcceptedHunks`
      + `applyApprovedContent` in `proposeEdit.ts`)
- [ ] Verify Ctrl+Z actually undoes an applied edit cleanly — code is
      written to use the undo-stack-integrated API, but this has not
      been watched happen on screen yet (needs a real Extension
      Development Host run, see `docs/STATUS.md`)

### Phase 4 — streaming + cancellation (A3)
- [ ] Token deltas (`model.message.delta`) streamed into the webview live
- [ ] A visible Cancel button; verify `git status` shows nothing changed after a mid-flight cancel

### Phase 5 — resilience (B3 / Task C)
- [ ] Configure a second model in TrueForge as fallback
- [ ] On a turn-error event, retry automatically against the fallback agent spec, no user action
- [ ] Test by deliberately misconfiguring the primary model's endpoint/key

### Phase 6 — context-engineering depth (B4)
- [ ] Split exploration from editing: a "scout" subagent calls `repo_map`/`search_code`/`read_file` and hands a condensed file list + reasoning to the editing agent
- [ ] This should be visible in the TrueForge session transcript, not just claimed

### Phase 7 — the 3 fixed tasks, rehearsed
- [ ] Task A (inline edit, `get_debug_flag`) — rehearse until clean
- [ ] Task B (agent mode, `flask config` CLI command, 3+ files, none named) — rehearse the exact tool-call trace we want visible (see `docs/CONTEXT_STRATEGY.md`)
- [ ] Task C (resilience) — rehearse breaking the model connection live

### Phase 8 — submission artifacts
- [ ] Demo video (≤4 min, all 3 tasks in order, each with on-screen verification, TrueForge session visible during Task B)
- [ ] Write-up PDF (8 headings, see `docs/WRITEUP_OUTLINE.md`)
- [ ] Public GitHub repo: flip this repo public, clean README, example model config (`.env.example`, no real secrets), confirm `npx @truefoundry/trueforge@latest` + extension load works from a clean clone

## Division of labour (edit this once the team is set)
See `docs/STATUS.md` for current ownership and progress per phase.
