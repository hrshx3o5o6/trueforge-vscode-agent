/**
 * read_file tool: structurally blocks the B1 zero-point anti-pattern
 * ("whole files concatenated until the window fills"). No range on a
 * file above the size threshold -> outline only. Range given -> capped
 * at READ_FILE_MAX_LINES.
 */
import * as fs from "node:fs/promises";
import { resolveInWorkspace } from "../workspace.js";
import { getSymbolsWithFallback } from "../editorSymbols.js";

export const READ_FILE_OUTLINE_THRESHOLD_LINES = 40;
export const READ_FILE_MAX_LINES = 200;

export interface ReadFileResult {
  mode: "full" | "range" | "outline";
  content: string;
  totalLines: number;
}

export async function readFile(
  relativePath: string,
  range?: { start: number; end: number },
): Promise<ReadFileResult> {
  const absPath = resolveInWorkspace(relativePath);
  const text = await fs.readFile(absPath, "utf8");
  const lines = text.split("\n");
  const totalLines = lines.length;

  if (range) {
    const start = Math.max(0, range.start);
    const end = Math.min(lines.length, Math.max(start + 1, range.end));
    const clampedEnd = Math.min(end, start + READ_FILE_MAX_LINES);
    const content = lines.slice(start, clampedEnd).join("\n");
    return { mode: "range", content, totalLines };
  }

  if (totalLines <= READ_FILE_OUTLINE_THRESHOLD_LINES) {
    return { mode: "full", content: text, totalLines };
  }

  const { symbols, source } = await getSymbolsWithFallback(absPath, text);
  const outlineLines = symbols.map((s) => `  L${s.line + 1}: ${s.kind === "class" ? "class" : "def"} ${s.name}`);
  const outline = [
    `# ${relativePath} has ${totalLines} lines — showing outline only (symbols via ${source}).`,
    `# Call read_file again with a line range to see the body of any symbol below.`,
    ...outlineLines,
  ].join("\n");
  return { mode: "outline", content: outline, totalLines };
}
