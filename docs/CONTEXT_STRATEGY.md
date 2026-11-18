# Context assembly strategy (our biggest differentiator — B1, 15 pts)

**Core idea: don't pre-retrieve for the agent. Give it cheap, bounded tools
and let its own tool-loop decide what to fetch.** This is literally what
"agent mode... finding them is the agent's job" means in the brief, and it's
also what the B1 top anchor requires: *"retrieval with a size budget,
strategy stated, and visibly at work in Task B."*

## The 4 tools and their hard budgets

### 1. `repo_map()`
- Directory tree + top-level symbols (class/function signatures only, no
  bodies) per file.
- Symbols pulled via VS Code's own `DocumentSymbolProvider` API — reuses
  the already-running language server, not a hand-rolled parser. This is
  "editor-native" and a point worth making explicitly in the write-up.
- **Budget: ≤4,000 tokens.** On `pallets/flask` (~17k lines) this
  compresses to signatures only — a large reduction.
- Computed once per session, cached, invalidated on file-save via a
  `FileSystemWatcher`. Never recomputed every turn.

### 2. `search_code(query, path_glob?)`
- ripgrep-backed keyword/regex search.
- **Budget: max 20 results, ≤300 chars per snippet (~1.5k tokens/call).**
  Beyond 20 matches, returns a count and asks the agent to narrow the
  query — teaches good agent behaviour structurally, not by prompting.

### 3. `read_file(path, range?)`
- No range given on a file above a size threshold → returns the file's
  **outline only** (reuses `repo_map`'s per-file symbol extraction), not
  the full text.
- Range given → capped at ~200 lines (~1.5k tokens).
- This is the structural guard against the B1 zero-point anti-pattern
  ("whole files concatenated until the window fills").

### 4. `go_to_definition(symbol)`
- Wraps `vscode.executeDefinitionProvider` directly — precise,
  editor-native, much cheaper than grep for "where is X actually defined."
- Most forked AI-coding extensions only ever grep; wiring in the editor's
  own language intelligence for this is a genuine differentiator worth a
  sentence in the write-up.

## Stated budget total (quote this directly in the write-up)
Repo map ≤4k tokens + per-call tool results ≤~1.5k tokens each → total
tool-context per turn stays well under ~10k tokens even on a 17k-line
repo, leaving the rest of the model's context window for conversation
history, system instructions, and the model's own reasoning/output.

## Combine with subagents to also capture B4
Split into a **scout subagent** (only calls `repo_map`/`search_code`/
`read_file`, returns a condensed "here are the 3 relevant files and why")
feeding a separate **editing agent** that only sees that condensed summary.
This satisfies B1 ("visibly at work") *and* B4's top anchor ("meaningful
subagent use") with one coherent design, not two bolted-on features.

## The exact Task B trace we want visible on screen
Task B instruction: *"Add a `flask config` CLI command that prints the
loaded application's configuration as JSON, masking the values of any key
containing SECRET, PASSWORD, TOKEN or KEY... must appear in `flask --help`,
be covered by a test, and be documented alongside the other built-in
commands."* No files named.

Expected/rehearsed trace:
1. Scout subagent calls `repo_map()` → sees `src/flask/cli.py` exists,
   already has commands like `run`, `shell`, `routes`.
2. Scout calls `search_code("@click.command")` → finds the exact
   decorator pattern existing commands use.
3. Scout calls `read_file("src/flask/cli.py", <range around routes_command>)`
   → learns the precise style to mimic.
4. Scout hands the editing agent: "add to `cli.py` following the
   `routes_command` pattern; register in the CLI group; add a test in
   `tests/test_cli.py`; the docs live in `docs/cli.rst` (check if it
   needs updating too)."
5. Editing agent calls `propose_edit` for each of 3+ files.
6. Verification: `pytest tests/test_cli.py -q`, then run `flask config`
   against a real app and show masked JSON.

This whole trace needs to be **rehearsed and reliable**, not improvised on
camera — script it, run it multiple times, and know exactly which tool
calls should appear before recording the demo video.

## What NOT to do (the anti-patterns the anchors are written against)
- Don't dump whole files into context "just in case."
- Don't do retrieval only on explicit `@file` mentions (scores 5, not 15)
  — automatic discovery for agent mode is required for the top anchors.
- Don't recompute `repo_map` on every single turn — cache it.
