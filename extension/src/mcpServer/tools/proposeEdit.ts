/**
 * propose_edit tool: computes a diff and returns it. NEVER writes to
 * disk itself.
 *
 * ARCHITECTURE DECISION (Phase 3, supersedes the comment that used to be
 * here): human review is implemented as our OWN in-process gate, not a
 * TrueForge-native "tool needs approval" event — the installed SDK's
 * reference docs (checked directly, not assumed) expose no such concept.
 * Since an MCP tool call is just a request our server hasn't responded to
 * yet, the propose_edit handler in mcpServer.ts calls
 * `approvalRegistry.requestEditApproval()` and simply does not resolve
 * until the user acts in the webview (diffReview.ts renders the hunks,
 * extension.ts relays the decision back). This needs no unconfirmed
 * TrueForge API surface and gives exact per-hunk granularity for free.
 */
import * as fs from "node:fs/promises";
import { createPatch, structuredPatch, applyPatch } from "diff";
import { resolveInWorkspace, toRelative } from "../workspace.js";

export interface EditHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[]; // unified-diff lines, including the leading +/-/space
}

export interface ProposeEditResult {
  path: string;
  unifiedDiff: string;
  hunks: EditHunk[];
  fileExisted: boolean;
  oldContent: string;
  newContent: string;
}

/** Computes hunks for a single file given its full proposed new content.
 * One call = one file. For a multi-file change (Task B), the agent should
 * call this once per file — each call is its own approval unit, which is
 * what gives us per-hunk-ish granularity without an unverified API. */
export async function proposeEdit(relativePath: string, newContent: string): Promise<ProposeEditResult> {
  const absPath = resolveInWorkspace(relativePath);
  let oldContent = "";
  let fileExisted = true;
  try {
    oldContent = await fs.readFile(absPath, "utf8");
  } catch {
    fileExisted = false;
  }

  const unifiedDiff = createPatch(relativePath, oldContent, newContent, "current", "proposed");
  const structured = structuredPatch(relativePath, relativePath, oldContent, newContent, "current", "proposed");

  const hunks: EditHunk[] = structured.hunks.map((h) => ({
    oldStart: h.oldStart,
    oldLines: h.oldLines,
    newStart: h.newStart,
    newLines: h.newLines,
    lines: h.lines,
  }));

  return { path: toRelative(absPath), unifiedDiff, hunks, fileExisted, oldContent, newContent };
}

/** True per-hunk acceptance: rebuilds file content using only the hunks
 * the user accepted, by re-serializing a unified diff containing just
 * those hunks and running it through `diff`'s own patch applier — so the
 * reconstruction logic is the same well-tested library, not hand-rolled
 * line splicing that could silently corrupt a file. */
export function reconstructContentFromAcceptedHunks(
  relativePath: string,
  oldContent: string,
  allHunks: EditHunk[],
  acceptedIndices: Set<number>,
): string {
  const acceptedHunks = allHunks.filter((_, i) => acceptedIndices.has(i));
  if (acceptedHunks.length === 0) {return oldContent;}

  const header = `Index: ${relativePath}\n===================================================================\n--- ${relativePath}\tcurrent\n+++ ${relativePath}\tproposed\n`;
  const hunkText = acceptedHunks
    .map((h) => `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n${h.lines.join("\n")}`)
    .join("\n");
  const patchText = header + hunkText + "\n";

  const result = applyPatch(oldContent, patchText);
  if (result === false) {
    throw new Error(
      `Could not apply the accepted hunks to ${relativePath} — the file changed since the diff was computed. Re-run propose_edit.`,
    );
  }
  return result;
}
