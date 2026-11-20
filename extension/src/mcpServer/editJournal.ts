/**
 * Records every change the agent applied, so that:
 *  - the user can undo any single applied change from the panel (B2);
 *  - a cancelled or failed run is rolled back as a whole, leaving no
 *    half-applied multi-file edit behind (A3 / Task C).
 *
 * All writes go through VS Code's WorkspaceEdit (so Ctrl+Z also works
 * in an open editor) and are then SAVED: a WorkspaceEdit alone only
 * changes the in-memory document, so pytest / python run from a
 * terminal would still see the old file on disk.
 */
import * as vscode from "vscode";
import { resolveInWorkspace } from "./workspace.js";

export interface JournalEntry {
  id: number;
  turn: number;
  path: string;
  before: string;
  after: string;
  existed: boolean;
  undone: boolean;
}

let nextId = 1;
let currentTurn = 0;
const entries: JournalEntry[] = [];
const listeners: Array<(e: JournalEntry) => void> = [];

export function onApplied(listener: (e: JournalEntry) => void): void {
  listeners.push(listener);
}

export function beginTurn(): number {
  return ++currentTurn;
}

/** Writes content through the editor's undoable edit API and saves it to disk. */
export async function writeAndSave(relativePath: string, content: string): Promise<void> {
  const uri = vscode.Uri.file(resolveInWorkspace(relativePath));
  const edit = new vscode.WorkspaceEdit();
  let doc: vscode.TextDocument | undefined;
  try {
    doc = await vscode.workspace.openTextDocument(uri);
  } catch {
    doc = undefined;
  }
  if (doc) {
    edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), content);
  } else {
    edit.createFile(uri, { overwrite: false, contents: Buffer.from(content, "utf8") });
  }
  if (!(await vscode.workspace.applyEdit(edit))) {
    throw new Error(`VS Code refused the edit to ${relativePath}`);
  }
  const saved = await vscode.workspace.openTextDocument(uri);
  if (saved.isDirty && !(await saved.save())) {
    throw new Error(`Could not save ${relativePath}`);
  }
}

async function deleteFile(relativePath: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  edit.deleteFile(vscode.Uri.file(resolveInWorkspace(relativePath)), { ignoreIfNotExists: true });
  await vscode.workspace.applyEdit(edit);
}

export async function applyAndRecord(path: string, before: string, existed: boolean, after: string): Promise<JournalEntry> {
  await writeAndSave(path, after);
  const entry: JournalEntry = { id: nextId++, turn: currentTurn, path, before, after, existed, undone: false };
  entries.push(entry);
  listeners.forEach((l) => l(entry));
  return entry;
}

export async function undoEntry(id: number): Promise<string> {
  const entry = entries.find((e) => e.id === id);
  if (!entry) {return "Unknown change.";}
  if (entry.undone) {return `Already undone: ${entry.path}`;}
  if (entry.existed) {
    await writeAndSave(entry.path, entry.before);
  } else {
    await deleteFile(entry.path);
  }
  entry.undone = true;
  return `Reverted ${entry.path}`;
}

/** Undo every still-applied change from a turn, newest first. Returns the paths restored. */
export async function rollbackTurn(turn: number): Promise<string[]> {
  const restored: string[] = [];
  for (const entry of [...entries].reverse()) {
    if (entry.turn === turn && !entry.undone) {
      await undoEntry(entry.id);
      restored.push(entry.path);
    }
  }
  return restored;
}
