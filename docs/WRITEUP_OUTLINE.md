# Write-up outline (PDF, 1-3 pages, these 8 headings in order — required)

Fill this in as we build, not retroactively the night before the
deadline — the scorecard section specifically needs real timestamps from
the actual recorded video.

## 1. Team
Members, college/employer, GitHub handles. See `docs/TEAM.md`.

## 2. Starting point
Upstream repository and commit, or "from scratch."
> Forked `sst/opencode`, subdirectory `sdks/vscode/`, commit
> `521ceac004e59fbbfca0929596107cd8430f2b26`. The official extension is a
> thin terminal launcher; we built the webview, diff-review UI, and
> TrueForge SDK integration ourselves on top of its activation scaffolding.

## 3. Architecture on TrueForge
How the extension talks to TrueForge, which editor capabilities are
exposed as MCP tools, which harness features used and why.
→ Summarize `docs/ARCHITECTURE.md`. Name the exact MCP tools and confirm
tool-approval drives the diff review (this is literally the B4 top-anchor
wording — use it).

## 4. How context is selected
Retrieval strategy and its budget.
→ Summarize `docs/CONTEXT_STRATEGY.md`. State the token budget numbers
explicitly (repo map ≤4k, per-call ≤~1.5k). This section directly
targets B1's 15-point top anchor — don't be vague here.

## 5. Model setup
Models used, where they ran, approximate cost, how a user switches models.
→ List both configured providers (primary + fallback for Task C). State
real approximate cost (even "$0, free tier" is fine — fairness rule means
model cost isn't scored, just declared).

## 6. Scorecard
One row per judging criterion: video timestamp where it's shown + a
one-line claim. Table format, e.g.:

| Criterion | Timestamp | Claim |
|---|---|---|
| A1 Inline edit | 0:05-0:22 | Per-hunk diff accept shown for `get_debug_flag` |
| A2 Agent mode | 0:23-1:40 | 3 files edited, none named, shown via TrueForge session |
| B1 Context assembly | 0:35-0:55 | `repo_map`/`search_code` calls visible before any edit |
| B3 Resilience | 2:50-3:20 | Primary model broken, automatic fallback shown, `git status` clean |
| ... | | |

Fill every row with a REAL timestamp from the actual final video, not a
placeholder.

## 7. Tools used
Any AI coding assistants used to build this (costs no points, must be
declared). Be honest and specific.

## 8. Known limitations and what you'd do with another month
Write this honestly — the top anchor (15/15) explicitly requires "an
honest limitations section." Don't pad with fake modesty; name the real
gaps. Draft candidates (update as true gaps emerge):
- No OCR/non-text context handling.
- `go_to_definition` only as good as the language server's own accuracy
  on Flask's codebase.
- Subagent split (scout vs. editor) is a fixed 2-stage pipeline, not
  dynamically decided by the agent itself — a month more would make this
  itself an agent decision (e.g. via TrueForge's dynamic subagents).
- No automated test suite for the MCP server tools themselves.
