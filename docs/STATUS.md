# Status — what's done, what's not, who owns what

Update this file as work happens. This is the fastest way for a new
teammate to know what's real vs. planned.

## Done (verified, not just written)
- [x] TrueForge server running locally at `http://localhost:8790`
      (verified 2026-11-18, standalone mode, SQLite, health check OK)
- [x] Fork base copied in from `sst/opencode` @ `521ceac004e59fbbfca0929596107cd8430f2b26`
- [x] Repo scaffolded with full planning docs (this one + PLAN/ARCHITECTURE/
      CONTEXT_STRATEGY/SCORING_MAP/TASKS/SETUP/DECISIONS/WRITEUP_OUTLINE)

## Not started yet
- [ ] Model provider configured in TrueForge (needs a real API key —
      whoever has one, do this next and update `docs/SETUP.md` with which
      provider)
- [ ] SDK smoke test script
- [ ] MCP tool server (`mcp-server/`) — currently just an empty directory
- [ ] Extension changes (webview, diff handler, SDK wiring) — `extension/`
      is still the unmodified fork, needs all of Phase 2-4 from `docs/PLAN.md`
- [ ] Task A/B/C rehearsal
- [ ] Demo video
- [ ] Write-up PDF

## Ownership
_(fill in once the team divides work — suggested split below, not fixed)_
- MCP tool server (`mcp-server/`): ?
- Extension webview + diff UI (`extension/`): ?
- TrueForge agent/model config + resilience (Task C): ?
- Write-up + video: ?

## Deadline
**Round 1 submission: 20 November 2026, 23:59 IST.** Today is 18 November.
Given the timeline, prioritize ruthlessly per `docs/PLAN.md`'s phase order
— Phase 0-4 are non-negotiable; Phase 6 (subagent split) is valuable but
cuttable if time runs out; a working, rehearsed Phase 7 demo matters more
than a perfect Phase 6.
