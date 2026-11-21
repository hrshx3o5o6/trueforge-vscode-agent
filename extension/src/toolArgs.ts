/**
 * Shortens a tool call's arguments for display in the panel and trace.
 * TrueForge's events carry the model's full arguments, and propose_edit's
 * new_content is the whole file, which must not be dumped on screen.
 */
const MAX_STRING = 120;
const LINE_COUNTED = new Set(["new_content"]);

export function summarizeToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== "string") {
      out[key] = value;
    } else if (LINE_COUNTED.has(key)) {
      out[key] = `<${value.split("\n").length} lines>`;
    } else {
      out[key] = value.length > MAX_STRING ? value.slice(0, MAX_STRING) + "…" : value;
    }
  }
  return out;
}
