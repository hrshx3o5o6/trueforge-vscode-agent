/**
 * Lightweight, dependency-free top-level symbol extraction for common
 * languages. Used as a fallback when no editor-native symbol provider is
 * registered (e.g. a judge's environment without the Python extension
 * installed) — and as the primary source for repo_map's directory-wide
 * scan, where calling executeDocumentSymbolProvider on every file in a
 * 17k-line repo would be too slow to do synchronously for every entry.
 *
 * go_to_definition / the single-file "outline" path in read_file prefer
 * the real editor-native provider first (see editorSymbols.ts) and only
 * fall back to this.
 */

export interface SymbolHit {
  name: string;
  kind: "function" | "class" | "method";
  line: number; // 0-indexed
}

const PY_DEF = /^(?:\s{0,3})(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/;
const PY_CLASS = /^(?:\s{0,3})class\s+([A-Za-z_]\w*)\s*[(:]/;
const JS_FUNC = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
const JS_CLASS = /^(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/;
const JS_CONST_ARROW = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/;

export function extractTopLevelSymbols(text: string, languageHint: string): SymbolHit[] {
  const lines = text.split("\n");
  const hits: SymbolHit[] = [];
  const isPython = languageHint === "py";
  const isJsLike = ["js", "jsx", "ts", "tsx", "mjs", "cjs"].includes(languageHint);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isPython) {
      // Only count indentation <= 1 level (0 or 4 spaces) as "top-level enough"
      // to be useful in a repo map without pulling in every nested helper.
      const indent = line.length - line.trimStart().length;
      if (indent > 4) {continue;}
      const def = line.match(PY_DEF);
      if (def) {
        hits.push({ name: def[1], kind: indent > 0 ? "method" : "function", line: i });
        continue;
      }
      const cls = line.match(PY_CLASS);
      if (cls) {
        hits.push({ name: cls[1], kind: "class", line: i });
      }
    } else if (isJsLike) {
      const fn = line.match(JS_FUNC);
      if (fn) {
        hits.push({ name: fn[1], kind: "function", line: i });
        continue;
      }
      const cls = line.match(JS_CLASS);
      if (cls) {
        hits.push({ name: cls[1], kind: "class", line: i });
        continue;
      }
      const arrow = line.match(JS_CONST_ARROW);
      if (arrow) {
        hits.push({ name: arrow[1], kind: "function", line: i });
      }
    }
  }
  return hits;
}

export function languageHintFromPath(filePath: string): string {
  const ext = filePath.split(".").pop() ?? "";
  return ext.toLowerCase();
}

export const SOURCE_EXTENSIONS = new Set([
  "py",
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "go",
  "rs",
  "java",
  "rb",
  "c",
  "cpp",
  "h",
  "hpp",
]);
