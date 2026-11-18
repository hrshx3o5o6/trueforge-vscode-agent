/**
 * search_code tool: ripgrep-backed. Capped at 20 results, ~300 chars per
 * snippet (docs/CONTEXT_STRATEGY.md's stated budget) — beyond that it
 * returns a count and asks the agent to narrow the query, structurally,
 * not by hoping the model behaves.
 */
import { spawn } from "node:child_process";
import { getWorkspaceRoot, toRelative } from "../workspace.js";

export const SEARCH_MAX_RESULTS = 20;
export const SEARCH_SNIPPET_MAX_CHARS = 300;

export interface SearchHit {
  file: string;
  line: number;
  snippet: string;
}

export interface SearchResult {
  hits: SearchHit[];
  totalMatches: number;
  truncated: boolean;
}

function runRipgrep(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("rg", args, { cwd });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      // rg exits 1 when there are simply no matches — not an error for us.
      if (code === 0 || code === 1) {resolve(stdout);}
      else {reject(new Error(stderr || `ripgrep exited with code ${code}`));}
    });
  });
}

export async function searchCode(query: string, pathGlob?: string): Promise<SearchResult> {
  const root = getWorkspaceRoot();
  const args = ["--line-number", "--no-heading", "--max-count", "200", "--color", "never"];
  if (pathGlob) {args.push("--glob", pathGlob);}
  args.push("--", query, ".");

  const output = await runRipgrep(args, root);
  const lines = output.split("\n").filter(Boolean);
  const totalMatches = lines.length;
  const truncated = totalMatches > SEARCH_MAX_RESULTS;
  const hits: SearchHit[] = [];

  for (const line of lines.slice(0, SEARCH_MAX_RESULTS)) {
    // ripgrep --no-heading format: path:lineNumber:content
    const match = line.match(/^(.+?):(\d+):(.*)$/);
    if (!match) {continue;}
    const [, filePath, lineNumStr, content] = match;
    const snippet = content.length > SEARCH_SNIPPET_MAX_CHARS ? content.slice(0, SEARCH_SNIPPET_MAX_CHARS) + "…" : content;
    hits.push({ file: toRelative(filePath), line: Number(lineNumStr), snippet: snippet.trim() });
  }

  return { hits, totalMatches, truncated };
}
