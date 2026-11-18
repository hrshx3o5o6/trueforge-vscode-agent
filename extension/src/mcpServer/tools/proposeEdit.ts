/**
 * propose_edit tool: computes a diff and returns it. NEVER writes to
 * disk itself — TrueForge marks this tool as needing approval (configured
 * in Settings -> Connectors once the server is registered), so the turn
 * pauses here. The extension's approval handler (diffHandler.ts, Phase 3)
 * renders this per-hunk in the editor and only calls
 * vscode.workspace.applyEdit for hunks the user actually accepts — so the
 * *real* write happens in the extension, after human review, never here.
 *
 * ASSUMPTION TO VERIFY (docs/SETUP.md "known gaps"): per-hunk accept/reject
 * requires either (a) TrueForge's approval-resolution API accepting a
 * modified/subset payload, or (b) us treating each hunk as its own
 * propose_edit call so TrueForge's generic per-call approval already gives
 * hunk granularity for free. Design here assumes (b) — one propose_edit
 * call per contiguous hunk — because it needs no unconfirmed API surface.
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

  return { path: toRelative(absPath), unifiedDiff, hunks, fileExisted };
}

/** Called by the extension's approval handler once hunks are accepted —
 * this is the ONLY place that actually touches disk, and only via VS
 * Code's own undoable edit API, never a raw fs.writeFile. */
export async function applyApprovedContent(relativePath: string, newContent: string): Promise<void> {
  const vscode = await import("vscode");
  const absPath = resolveInWorkspace(relativePath);
  const uri = vscode.Uri.file(absPath);
  let doc: import("vscode").TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(uri);
  } catch {
    // File doesn't exist yet — create it via a WorkspaceEdit too, so it's
    // still undoable in one step.
    const edit = new vscode.WorkspaceEdit();
    edit.createFile(uri, { overwrite: false, contents: Buffer.from(newContent, "utf8") });
    await vscode.workspace.applyEdit(edit);
    return;
  }
  const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, fullRange, newContent);
  await vscode.workspace.applyEdit(edit);
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
  if (acceptedHunks.length === 0) return oldContent;

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
