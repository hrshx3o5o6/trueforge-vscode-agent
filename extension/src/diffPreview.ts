/**
 * Shows a proposed change in VS Code's own diff editor (current file on
 * the left, proposed content on the right) while the per-hunk review card
 * is open in the panel. The proposed side is a read-only virtual document,
 * so nothing touches disk until hunks are accepted.
 */
import * as vscode from "vscode";
import { resolveInWorkspace } from "./mcpServer/workspace.js";

export const PROPOSED_SCHEME = "trueforge-proposed";

export class ProposedContentProvider implements vscode.TextDocumentContentProvider {
  private readonly docs = new Map<string, string>();
  private counter = 0;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.docs.get(uri.toString()) ?? "";
  }

  /** Opens the diff editor; returns the proposed-side URI (handle for closeDiff). */
  async openDiff(relativePath: string, newContent: string): Promise<vscode.Uri> {
    const id = ++this.counter;
    const proposed = vscode.Uri.from({ scheme: PROPOSED_SCHEME, path: "/" + relativePath, query: `v=${id}` });
    this.docs.set(proposed.toString(), newContent);

    const fileUri = vscode.Uri.file(resolveInWorkspace(relativePath));
    let original = fileUri;
    try {
      await vscode.workspace.fs.stat(fileUri);
    } catch {
      original = vscode.Uri.from({ scheme: PROPOSED_SCHEME, path: "/" + relativePath, query: `empty=${id}` });
      this.docs.set(original.toString(), "");
    }

    await vscode.commands.executeCommand(
      "vscode.diff",
      original,
      proposed,
      `${relativePath} ↔ proposed by TrueForge agent (review hunks in the panel)`,
      { preview: true, preserveFocus: true, viewColumn: vscode.ViewColumn.One },
    );
    return proposed;
  }

  async closeDiff(proposed: vscode.Uri): Promise<void> {
    const key = proposed.toString();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.toString() === key) {
          await vscode.window.tabGroups.close(tab, true);
        }
      }
    }
    this.docs.delete(key);
  }
}
