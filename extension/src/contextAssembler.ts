/**
 * Builds the <context> block sent with a request, under a hard token
 * budget, and reports every item it chose (and why) so the panel can
 * show the selection. Three sources, in priority order:
 *
 *  1. @file mentions  — the file (full if small, outline + head if large).
 *  2. @symbol mentions — the definition body, located with the editor's
 *     workspace-symbol provider, falling back to a ripgrep def/class search.
 *  3. Automatic retrieval — keywords from the request are ranked by
 *     IDF across the repo; files are scored by how many distinct rare
 *     keywords they contain, and the best files contribute only the
 *     windows around their matches, never whole files.
 *
 * This is the editor's opening bid. The agent still explores with
 * repo_map / search_code / read_file for anything not included.
 */
import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import { getWorkspaceRoot, resolveInWorkspace, toRelative } from "./mcpServer/workspace.js";
import { runRipgrep } from "./mcpServer/ripgrep.js";
import { estimateTokens } from "./mcpServer/tokenBudget.js";
import { getSymbolsWithFallback } from "./mcpServer/editorSymbols.js";

export interface ContextItem {
  label: string;
  reason: string;
  tokens: number;
  text: string;
}

export interface AssembledContext {
  block: string;
  items: ContextItem[];
  usedTokens: number;
  budget: number;
  dropped: number;
}

const SEARCH_GLOBS = ["*.{py,js,jsx,ts,tsx,go,rs,java,rb,c,cpp,h,hpp,md,rst,txt,toml,cfg,ini,yaml,yml}"];
const STOPWORDS = new Set(
  ("the and for with that this from into when then than also must should would could make sure have has been " +
    "add new any all each every other only just like what which where while about after before value values " +
    "file files code change update use using used treat well them they their there here print prints show " +
    "able cover covered alongside appear instruct please need needs want wants given same").split(" "),
);

const CHANGELOG = /(^|\/)(CHANGES|CHANGELOG|HISTORY|NEWS)(\.[a-z]+)?$/i;

function fileKind(rel: string): "test" | "doc" | "source" {
  if (/(^|\/)(tests?|spec|__tests__)\/|(^|\/)test_[^/]*$|_test\.[a-z]+$|\.(test|spec)\.[a-z]+$/i.test(rel)) {return "test";}
  if (/\.(md|rst|txt)$/i.test(rel) || /(^|\/)docs?\//i.test(rel)) {return "doc";}
  return "source";
}

function mentionTokens(request: string): string[] {
  return [...request.matchAll(/(?:^|\s)@([A-Za-z0-9_./\\-]+[A-Za-z0-9_])/g)].map((m) => m[1]);
}

async function exists(rel: string): Promise<boolean> {
  try { await fs.stat(resolveInWorkspace(rel)); return true; } catch { return false; }
}

async function resolveFileMention(token: string): Promise<string | undefined> {
  if (await exists(token)) {return token;}
  const hits = await vscode.workspace.findFiles(`**/${token}`, "**/{node_modules,.git,.venv,venv,dist,build}/**", 2);
  return hits.length ? toRelative(hits[0].fsPath) : undefined;
}

async function fileItem(rel: string, budgetTokens: number): Promise<ContextItem> {
  const text = await fs.readFile(resolveInWorkspace(rel), "utf8");
  const lines = text.split("\n");
  let body = text;
  let how = "full file";
  if (estimateTokens(text) > budgetTokens) {
    const { symbols } = await getSymbolsWithFallback(resolveInWorkspace(rel), text);
    const outline = symbols.map((s) => `L${s.line + 1}: ${s.kind} ${s.name}`).join("\n");
    const headLines = Math.max(10, Math.floor((budgetTokens - estimateTokens(outline)) * 4 / 60));
    body = `# outline (${lines.length} lines)\n${outline}\n# first ${headLines} lines\n${lines.slice(0, headLines).join("\n")}`;
    how = "outline + head (file too large for budget)";
  }
  return { label: `@${rel}`, reason: `you @-mentioned it — ${how}`, tokens: estimateTokens(body), text: body };
}

async function findSymbol(name: string): Promise<{ rel: string; line: number } | undefined> {
  try {
    const syms = await vscode.commands.executeCommand<vscode.SymbolInformation[]>("vscode.executeWorkspaceSymbolProvider", name);
    const exact = (syms ?? []).filter((s) => s.name === name || s.name.endsWith("." + name));
    if (exact.length) {return { rel: toRelative(exact[0].location.uri.fsPath), line: exact[0].location.range.start.line };}
  } catch { /* no provider — fall through to ripgrep */ }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const out = await runRipgrep(
    ["-n", "--no-heading", "--color", "never", "-e", `^\\s*(async\\s+)?(def|class|function|func|fn)\\s+${escaped}\\b`, "."],
    getWorkspaceRoot(),
  );
  const m = out.split("\n")[0]?.match(/^(.+?):(\d+):/);
  return m ? { rel: toRelative(resolveInWorkspace(m[1])), line: Number(m[2]) - 1 } : undefined;
}

async function symbolItem(name: string): Promise<ContextItem | undefined> {
  const loc = await findSymbol(name);
  if (!loc) {return undefined;}
  const lines = (await fs.readFile(resolveInWorkspace(loc.rel), "utf8")).split("\n");
  const indent = (s: string) => s.length - s.trimStart().length;
  const start = loc.line;
  let end = start + 1;
  while (end < lines.length && end - start < 120) {
    const l = lines[end];
    if (l.trim() && indent(l) <= indent(lines[start]) && !/^\s*[)\]}]/.test(l)) {break;}
    end++;
  }
  const body = lines.slice(start, end).join("\n");
  return { label: `@${name}`, reason: `you @-mentioned it — defined at ${loc.rel}:${start + 1}`, tokens: estimateTokens(body), text: `# ${loc.rel}:${start + 1}\n${body}` };
}

function keywords(request: string): Array<{ kw: string; weight: number }> {
  const seen = new Map<string, number>();
  for (const m of request.replace(/@\S+/g, " ").matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) {
    const raw = m[0];
    let kw = raw.toLowerCase();
    if (kw.length > 4 && kw.endsWith("s") && !kw.endsWith("ss")) {kw = kw.slice(0, -1);} // commands -> command(s)
    if (STOPWORDS.has(kw) || kw.length < 3) {continue;}
    // identifier-looking words (snake_case, camelCase, ALLCAPS) say more than prose
    const weight = /_|[a-z][A-Z]|^[A-Z0-9]{3,}$/.test(raw) ? 2 : 1;
    seen.set(kw, Math.max(seen.get(kw) ?? 0, weight));
  }
  return [...seen.entries()].map(([kw, weight]) => ({ kw, weight })).slice(0, 16);
}

async function retrieve(request: string, maxFiles: number): Promise<ContextItem[]> {
  const root = getWorkspaceRoot();
  const kws = keywords(request);
  if (!kws.length) {return [];}
  const perFile = new Map<string, Map<string, number>>();
  const df = new Map<string, number>();
  await Promise.all(kws.map(async ({ kw }) => {
    const pattern = `${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s|es)?`;
    const args = ["-c", "-i", "-w", "--color", "never", ...SEARCH_GLOBS.flatMap((g) => ["--glob", g]), "-e", pattern, "."];
    const out = await runRipgrep(args, root).catch(() => "");
    const rows = out.split("\n").filter(Boolean);
    df.set(kw, rows.length);
    for (const row of rows) {
      const m = row.match(/^(.+):(\d+)$/);
      if (!m) {continue;}
      const rel = toRelative(resolveInWorkspace(m[1]));
      if (!perFile.has(rel)) {perFile.set(rel, new Map());}
      perFile.get(rel)!.set(kw, Number(m[2]));
    }
  }));
  for (const rel of [...perFile.keys()]) {
    if (CHANGELOG.test(rel)) {perFile.delete(rel);} // history files mention everything, explain nothing
  }
  const totalFiles = Math.max(perFile.size, 1);
  // Terms present in over half the matching files (e.g. the project's own
  // name) carry no signal: drop them from scoring and from match windows.
  const useful = kws.filter(({ kw }) => (df.get(kw) ?? 0) > 0 && (df.get(kw) ?? 0) / totalFiles <= 0.5);
  const idf = (kw: string) => Math.log(1 + totalFiles / (df.get(kw) ?? 1));
  const sizes = new Map<string, number>();
  await Promise.all([...perFile.keys()].map(async (rel) =>
    sizes.set(rel, (await fs.stat(resolveInWorkspace(rel)).catch(() => ({ size: 4000 }))).size)));
  const avgSize = [...sizes.values()].reduce((a, b) => a + b, 0) / Math.max(sizes.size, 1);

  const ranked = [...perFile.entries()].map(([rel, hits]) => {
    const nameTokens = new Set(rel.toLowerCase().split(/[\\/._-]+/));
    const lengthNorm = 1.2 * (0.25 + 0.75 * (sizes.get(rel) ?? avgSize) / avgSize);
    let score = 0;
    const matched: string[] = [];
    for (const { kw, weight } of useful) {
      const n = hits.get(kw);
      if (!n) {continue;}
      matched.push(kw);
      // BM25-style saturation with length normalisation, plus a strong
      // bonus when the term names the file itself (cli -> cli.py, test_cli.py, cli.rst).
      score += weight * idf(kw) * ((n * 2.2) / (n + lengthNorm)) + (nameTokens.has(kw) ? 3 * idf(kw) : 0);
    }
    return { rel, hits, score, matched, kind: fileKind(rel) };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score);

  // Tests and docs that share a name stem with the top source files are
  // where a change to those files is usually wired (cli.py -> test_cli.py, cli.rst).
  const GENERIC = new Set(["src", "lib", "test", "tests", "doc", "docs", "py", "ts", "js", "rst", "md", "txt", "index", "init", "main", "app"]);
  const stems = new Set(
    ranked.filter((r) => r.kind === "source").slice(0, 2)
      .flatMap((r) => (r.rel.split("/").pop() ?? "").toLowerCase().split(/[._-]+/))
      .filter((t) => t.length > 2 && !GENERIC.has(t)),
  );
  for (const r of ranked) {
    if (r.kind === "source") {continue;}
    const tokens = (r.rel.split("/").pop() ?? "").toLowerCase().split(/[._-]+/);
    if (tokens.some((t) => stems.has(t))) {r.score *= 1.6;}
  }
  ranked.sort((a, b) => b.score - a.score);
  const cutoff = (ranked[0]?.score ?? 0) * 0.3;
  while (ranked.length && ranked[ranked.length - 1].score < cutoff) {ranked.pop();}

  // Reserve one slot each for the best source, test and doc file — the
  // usual places a change must be wired into — then fill by score.
  const chosen: typeof ranked = [];
  for (const kind of ["source", "test", "doc"] as const) {
    const best = ranked.find((r) => r.kind === kind);
    if (best) {chosen.push(best);}
  }
  for (const r of ranked) {
    if (chosen.length >= maxFiles) {break;}
    if (!chosen.includes(r)) {chosen.push(r);}
  }
  chosen.sort((a, b) => b.score - a.score);
  const scored = chosen.map(({ rel, matched, kind, hits }) => ({
    rel, kind, hits: new Map(matched.map((k) => [k, hits.get(k)!])),
  }));

  const items: ContextItem[] = [];
  for (const { rel, hits, kind } of scored) {
    const text = await fs.readFile(resolveInWorkspace(rel), "utf8").catch(() => "");
    const lines = text.split("\n");
    const matched = [...hits.keys()];
    const re = new RegExp(`\\b(${matched.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(s|es)?\\b`, "i");
    const keep = new Set<number>();
    lines.forEach((l, i) => { if (re.test(l)) {for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 2); j++) {keep.add(j);}} });
    const picked = [...keep].sort((a, b) => a - b).slice(0, 60);
    let snippet = "";
    let prev = -2;
    for (const i of picked) { snippet += (i !== prev + 1 ? `\n... L${i + 1}\n` : "") + lines[i] + "\n"; prev = i; }
    const top = matched.sort((a, b) => (hits.get(b)! - hits.get(a)!)).slice(0, 5);
    items.push({ label: rel, reason: `auto-retrieved ${kind} file: matches ${top.join(", ")} (${lines.length} lines; match windows only)`, tokens: estimateTokens(snippet), text: snippet.trim() });
  }
  return items;
}

export async function assembleContext(
  request: string,
  budget: number,
  opts: { extra?: ContextItem[]; autoRetrieve?: boolean } = {},
): Promise<AssembledContext> {
  const candidates: ContextItem[] = [...(opts.extra ?? [])];
  for (const token of mentionTokens(request)) {
    const file = await resolveFileMention(token);
    const item = file ? await fileItem(file, Math.floor(budget * 0.5)) : await symbolItem(token);
    candidates.push(item ?? { label: `@${token}`, reason: "mentioned, but no matching file or symbol was found", tokens: 0, text: "" });
  }
  if (opts.autoRetrieve !== false) {candidates.push(...(await retrieve(request, 8)));}

  const items: ContextItem[] = [];
  let used = 0;
  let dropped = 0;
  for (const c of candidates) {
    if (used + c.tokens > budget) { dropped++; continue; }
    items.push(c);
    used += c.tokens;
  }
  const block = items.length
    ? `<context budget_tokens="${budget}" note="assembled by the editor; use tools for anything not here">\n` +
      items.filter((i) => i.text).map((i) => `## ${i.label} — ${i.reason}\n\`\`\`\n${i.text}\n\`\`\``).join("\n\n") +
      `\n</context>\n\n`
    : "";
  return { block, items, usedTokens: used, budget, dropped };
}
