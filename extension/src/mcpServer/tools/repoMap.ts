/**
 * repo_map tool: directory tree + top-level symbols per source file,
 * capped at a hard token budget (docs/CONTEXT_STRATEGY.md). Computed once
 * per session and cached; invalidated by a file-save watcher registered
 * in extension.ts, never recomputed on every turn.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getWorkspaceRoot, isIgnoredDir, toRelative } from "../workspace.js";
import { SOURCE_EXTENSIONS, languageHintFromPath, extractTopLevelSymbols } from "../symbolExtraction.js";
import { estimateTokens, truncateToTokenBudget } from "../tokenBudget.js";

export const REPO_MAP_TOKEN_BUDGET = 4000;
export const REPO_MAP_MAX_FILES = 500;

interface CacheEntry {
  text: string;
  tokens: number;
  builtAt: number;
}

let cache: CacheEntry | null = null;

export function invalidateRepoMapCache(): void {
  cache = null;
}

async function walk(dir: string, root: string, out: string[], limit: number): Promise<void> {
  if (out.length >= limit) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (out.length >= limit) return;
    if (entry.isDirectory()) {
      if (isIgnoredDir(entry.name)) continue;
      await walk(path.join(dir, entry.name), root, out, limit);
    } else if (entry.isFile()) {
      const ext = languageHintFromPath(entry.name);
      if (SOURCE_EXTENSIONS.has(ext)) {
        out.push(path.join(dir, entry.name));
      }
    }
  }
}

function formatFileEntry(relPath: string, symbols: { name: string; kind: string }[]): string {
  if (symbols.length === 0) return relPath;
  const sigs = symbols.map((s) => (s.kind === "class" ? `class ${s.name}` : `${s.name}()`));
  return `${relPath}: ${sigs.join(", ")}`;
}

export async function buildRepoMap(options: { forceRefresh?: boolean } = {}): Promise<{
  text: string;
  tokens: number;
  truncated: boolean;
  fileCount: number;
}> {
  if (cache && !options.forceRefresh) {
    return { text: cache.text, tokens: cache.tokens, truncated: false, fileCount: -1 };
  }

  const root = getWorkspaceRoot();
  const files: string[] = [];
  await walk(root, root, files, REPO_MAP_MAX_FILES);

  const lines: string[] = [];
  // Test files are lower priority for the map body — group them at the end
  // with paths only (no symbols) so they don't eat the token budget before
  // source files do.
  const sourceFiles = files.filter((f) => !toRelative(f).split(path.sep).some((seg) => seg === "tests" || seg === "test"));
  const testFiles = files.filter((f) => !sourceFiles.includes(f));

  for (const absPath of sourceFiles) {
    let content: string;
    try {
      content = await fs.readFile(absPath, "utf8");
    } catch {
      continue;
    }
    const hint = languageHintFromPath(absPath);
    const symbols = extractTopLevelSymbols(content, hint);
    lines.push(formatFileEntry(toRelative(absPath), symbols));
  }
  if (testFiles.length > 0) {
    lines.push(`\n# test files (${testFiles.length}, paths only):`);
    for (const f of testFiles) lines.push(toRelative(f));
  }

  const header = `# Repository map (${files.length} source files, budget ${REPO_MAP_TOKEN_BUDGET} tokens)\n`;
  const body = header + lines.join("\n");
  const { text, truncated } = truncateToTokenBudget(body, REPO_MAP_TOKEN_BUDGET);
  const tokens = estimateTokens(text);

  cache = { text, tokens, builtAt: Date.now() };
  return { text, tokens, truncated, fileCount: files.length };
}
