# Status — what's done, what's not

Last updated 2026-11-20 (branch `fix/audit-findings`).

## Done and verified
- [x] `npm install`, `tsc --noEmit`, `eslint src`, `node esbuild.js` all clean.
- [x] Per-hunk partial apply (`reconstructContentFromAcceptedHunks`) tested
      with mixed accept/reject sets on a 3-hunk file: correct output.
- [x] Context assembly run against `pallets/flask` 3.1.3 with the Task B
      wording: selects `src/flask/cli.py`, `tests/test_cli.py`,
      `docs/cli.rst` within a 6k-token budget.
- [x] Live TrueForge (local mode) behaviour confirmed by experiment:
      unknown `mcpServers` name → 422; tool calls arrive only as
      `model.message.delta` fragments; deferred tool discovery fails
      ("deferred-tools not found") → we preload; localhost connectors need
      `OUTBOUND_URL_ALLOWED_HOSTS` at both registration and connect time.

- [x] **Live against TrueForge (openai/gpt-5-4-mini)** with the real
      `TurnController`: native `tool.approval_required` → review →
      `user.tool_approval` allow → TrueForge resumes and calls the MCP tool;
      deny → tool never executes; cancel while paused → turn state
      `cancelled` on the server, nothing written. (The stream stays open
      while paused; the resubscribe path was not needed.)
- [x] Extension Development Host activates, auto-registers the connector
      on :4790 with its bearer token, and TrueForge lists all six tools.
- [x] Flask 3.1.3 test env: `pip install -e . pytest==8.4.2 asgiref greenlet
      python-dotenv` (latest pytest breaks Flask 3.1.3's test imports);
      baseline `tests/test_cli.py` 58 passed.

## Fixed on this branch (see git log for detail)
- [x] Agent spec never attached the MCP server → agent had no tools.
- [x] Connector auto-registration with bearer token; SSRF-guard hint.
- [x] Diff review driven by TrueForge-native tool approval.
- [x] Real cancel (`sessions.cancel` + stream abort) and whole-run rollback.
- [x] Applied edits saved to disk; per-change Undo button.
- [x] Stall watchdog, retry with backoff, automatic fallback.
- [x] Inline edit reports errors (used to fail silently), is cancellable,
      opens the diff in VS Code's diff editor.
- [x] `@file` / `@symbol` mentions + budgeted auto-retrieval with a
      visible "Context selected" card.
- [x] Bundled ripgrep; MCP port-conflict fallback; HTML escaping.

## Still to verify by hand (needs TrueForge restarted with the allow-list)
- [ ] Full Task A in the Extension Development Host: diff editor opens,
      per-hunk accept, file saved, `FLASK_DEBUG=off python -c ...` prints False.
- [ ] Task B end to end: 3+ files, pytest passes, `flask config` masks.
- [ ] Task C: invalid primary → retries → fallback; and no-fallback → clear error.
- [ ] Cancel mid-Task-B: `git status` clean afterwards.
- [ ] Undo button and Ctrl+Z on an applied change.

## Not started
- [ ] Demo video (≤ 4 min, tasks A → B → C, show TrueForge session in B)
- [ ] Write-up PDF (8 headings — see `docs/WRITEUP_OUTLINE.md`)
- [ ] Make the GitHub repo public before 20 Nov 23:59 IST
