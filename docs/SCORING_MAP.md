# Scoring map — 100 points, condensed from the official brief

Every criterion uses written anchors tied to fixed values; a judge picks
the description that fits. Where a submission sits between two anchors,
the **lower one applies** — so half-done work is scored as the weaker
anchor, not averaged. Build to clear the anchor, not just gesture at it.

## A. Capability coverage — 30 pts (the floor; build competently, don't over-invest)
| # | Criterion | 0 | 4 | 7 | 10 |
|---|---|---|---|---|---|
| A1 | Inline edit | not present / copy-paste output | edit, no diff in editor | diff rendered, accept-all only | diff rendered, **per-hunk** accept/reject |
| A2 | Agent mode | no tool loop | single file only | several files but user named them | **discovers 3+ files unprompted** |
| A3 | Streaming/cancellation | editor blocks | streams, no cancel | cancel works but can half-apply | cancel immediate, **workspace stays consistent** |

## B. Technical depth — 45 pts (where we concentrate effort — see docs/CONTEXT_STRATEGY.md)
| # | Criterion | Pts | 0 | 5/4 | 10/7 | 15/10 |
|---|---|---|---|---|---|---|
| B1 | Context assembly | 15 | whole files until window fills | explicit @-mentions only | automatic retrieval, strategy stated | **+ size budget + visibly at work in Task B** |
| B2 | Diff safety | 10 | writes without showing user | full-file preview | — | **per-hunk review + working undo shown on screen** |
| B3 | Resilience (Task C) | 10 | hang/crash/files changed | clear error, workspace unchanged | retry+backoff then clear error | **automatic fallback to 2nd model, zero user action** |
| B4 | TrueForge integration depth | 10 | — | sessions/turns only, editor actions handled outside harness | editor capabilities as MCP tools, approval drives diff review | **+ meaningful subagent/deferred-loading/Code Mode/compaction use** |

## C. Presentation — 25 pts (cheap points most rushed teams skip)
| # | Criterion | Pts | 0 | 5 | 10 | 15 |
|---|---|---|---|---|---|---|
| C1 | Video | 10 | task missing/out of order | all 3 present, not legible/verified | **all 3 complete, legible, verified on screen** | — |
| C2 | Write-up | 15 | absent/boilerplate | describes features, no design decisions | states architecture/context/model/trade-offs | **+ accurate scorecard w/ timestamps + honest limitations** |

## Eligibility gate (checked FIRST, pass/fail)
The agent loop must genuinely run on TrueForge. A submission that calls a
model provider directly, or keeps an upstream project's own agent loop, is
**ineligible regardless of score**. This is why `extension/` must be
stripped of anything assuming the `opencode` CLI/server — see
`docs/PLAN.md` Phase 2.

## Process notes
- 2 independent judges per submission; mean score; >15-point spread
  triggers a 3rd judge.
- Top 15 teams shortlisted. Before final: a 10-min live call, repeating
  Task A with a model **the organisers choose** — don't overfit prompts to
  one model, see `docs/DECISIONS.md`.
- Ties break on B, then A, then earlier submission time — technical depth
  is the tiebreaker, reinforcing where to spend effort.
