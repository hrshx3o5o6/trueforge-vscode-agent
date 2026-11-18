/**
 * Workspace path helpers shared by every tool. All tools operate relative
 * to the first open VS Code workspace folder; paths are always resolved
 * and clamped inside it — the agent can never read or write outside the
 * open repo, no matter what path it asks for.
 */
import * as vscode from "vscode";
import * as path from "node:path";

export class WorkspaceError extends Error {}

export function getWorkspaceRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new WorkspaceError("No workspace folder is open.");
  }
  return folders[0].uri.fsPath;
}

/** Resolve a repo-relative path to an absolute one, refusing to escape the workspace root. */
export function resolveInWorkspace(relativePath: string): string {
  const root = getWorkspaceRoot();
  const resolved = path.resolve(root, relativePath);
  const normalizedRoot = path.join(root, path.sep);
  if (resolved !== root && !resolved.startsWith(normalizedRoot)) {
    throw new WorkspaceError(`Path "${relativePath}" resolves outside the open workspace.`);
  }
  return resolved;
}

export function toRelative(absolutePath: string): string {
  return path.relative(getWorkspaceRoot(), absolutePath) || ".";
}

/** Directories we never walk or index — keeps repo_map/search cheap and relevant. */
export const DEFAULT_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "__pycache__",
  ".venv",
  "venv",
  ".mypy_cache",
  ".pytest_cache",
  ".tox",
  "*.egg-info",
]);

export function isIgnoredDir(name: string): boolean {
  if (DEFAULT_IGNORED_DIRS.has(name)) {return true;}
  if (name.endsWith(".egg-info")) {return true;}
  if (name.startsWith(".")) {return name !== "." && name !== "..";}
  return false;
}
