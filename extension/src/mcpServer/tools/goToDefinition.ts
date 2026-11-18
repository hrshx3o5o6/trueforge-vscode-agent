/**
 * go_to_definition tool: finds a symbol's real definition using VS Code's
 * own language providers — more precise than grep, and a genuine
 * differentiator since most forked AI-coding extensions only ever grep
 * (docs/CONTEXT_STRATEGY.md). Finds one usage via ripgrep's word-boundary
 * search, then asks the editor's own provider to resolve it from there.
 */
import * as vscode from "vscode";
import { searchCode } from "./searchCode.js";
import { goToDefinition as goToDefinitionCore, type DefinitionHit } from "../editorSymbols.js";
import { resolveInWorkspace } from "../workspace.js";

async function findOneUsage(symbolName: string): Promise<{ uri: vscode.Uri; position: vscode.Position } | null> {
  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const result = await searchCode(`\\b${escaped}\\b`);
  if (result.hits.length === 0) return null;
  const hit = result.hits[0];
  const absPath = resolveInWorkspace(hit.file);
  const uri = vscode.Uri.file(absPath);
  const doc = await vscode.workspace.openTextDocument(uri);
  const lineText = doc.lineAt(hit.line - 1).text;
  const col = lineText.indexOf(symbolName);
  const position = new vscode.Position(hit.line - 1, Math.max(0, col));
  return { uri, position };
}

export async function goToDefinition(symbolName: string): Promise<DefinitionHit | null> {
  return goToDefinitionCore(symbolName, findOneUsage);
}
