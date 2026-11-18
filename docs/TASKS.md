# The 3 fixed tasks (exact wording — do not paraphrase when demoing)

Pinned repo for all 3: `pallets/flask`, tag `3.1.3` (~17,000 lines, `src` + `tests`).
Clone it once, check out the tag, and don't change the clone's version.

## Task A — Inline edit (single file)
**Instruction to the agent:** Open `src/flask/helpers.py`, select the
function `get_debug_flag`, and instruct: *"Treat the values 'off' and 'n'
as false as well, case-insensitively, and update the docstring to list
every value that is treated as false."* Review and accept the diff.

**On-screen verification:**
```
FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"
```
must print `False`.

## Task B — Agent mode (3+ files, none named)
**Instruction to the agent** (in the agent panel, no files mentioned):
*"Add a built-in CLI command `flask config` that prints the loaded
application's configuration as JSON, masking the values of any key
containing SECRET, PASSWORD, TOKEN or KEY as `***`. It must appear in
`flask --help`, be covered by a test, and be documented alongside the
other built-in commands."*

Review the hunks and accept. **Show the TrueForge session for this run**
(turns and tool calls visible).

**On-screen verification:**
```
pytest tests/test_cli.py -q
```
must pass, including the new test; then run the new command against any
Flask app and show the masked JSON output.

**Must touch at least 3 files** — this is graded directly (A2, B1).

## Task C — Resilience
Configure TrueForge with an unreachable endpoint or an invalid key, then
**repeat Task A**.

**On-screen verification:** the editor stays responsive, the user sees a
clear message (or a second configured model takes over automatically),
and `git status` shows no files changed.

## Demo video requirements
- Max 4 minutes, screen recording, editor visible.
- Tasks **A, B, C in that order**, each followed by its on-screen
  verification.
- TrueForge session shown briefly during Task B.
- May cut model waiting time; **do not cut between giving an instruction
  and the diff appearing** (judges are checking responsiveness/legibility,
  not just the end state).
- Narration/captions optional.
- Public link (YouTube unlisted or Google Drive "anyone with the link").

## Rehearse all 3 before recording
Run the full A → B → C sequence multiple times on a clean checkout before
the real recording. A flub on camera (wrong file touched, an edit that
doesn't apply, a resilience test that doesn't actually fail cleanly) costs
real points — see `docs/SCORING_MAP.md`.
