/**
 * In-process human-approval gate (see the architecture note at the top of
 * tools/proposeEdit.ts). A tool handler calls one of the request*()
 * functions and its promise simply does not resolve until the webview
 * calls resolveEdit/resolveCommand with the user's decision — the MCP
 * HTTP request from TrueForge just stays open, which is a normal,
 * supported thing to do with a long-running tool call.
 */
import { createHash, randomUUID } from "node:crypto";
import type { ProposeEditResult, EditHunk } from "./tools/proposeEdit.js";

export interface PendingEditRequest {
  requestId: string;
  path: string;
  unifiedDiff: string;
  hunks: EditHunk[];
}

export interface EditDecision {
  /** Indices (into the original hunks array) the user accepted. Empty set = fully rejected. */
  acceptedHunkIndices: Set<number>;
}

export interface PendingCommandRequest {
  requestId: string;
  command: string;
}

type EditListener = (req: PendingEditRequest) => void;
type CommandListener = (req: PendingCommandRequest) => void;

const pendingEdits = new Map<string, { resolve: (d: EditDecision) => void; result: ProposeEditResult }>();
const pendingCommands = new Map<string, { resolve: (approved: boolean) => void }>();

const editListeners: EditListener[] = [];
const commandListeners: CommandListener[] = [];

export function onEditProposed(listener: EditListener): void {
  editListeners.push(listener);
}
export function onCommandProposed(listener: CommandListener): void {
  commandListeners.push(listener);
}

/** Called from the propose_edit tool handler. Resolves once the user
 * accepts/rejects hunks in the webview. No timeout: a human review step
 * is allowed to take as long as it takes; the UI's Cancel button is the
 * escape hatch, not a server-side timer. */
export function requestEditApproval(result: ProposeEditResult): Promise<EditDecision> {
  const requestId = randomUUID();
  return new Promise((resolve) => {
    pendingEdits.set(requestId, { resolve, result });
    const req: PendingEditRequest = {
      requestId,
      path: result.path,
      unifiedDiff: result.unifiedDiff,
      hunks: result.hunks,
    };
    editListeners.forEach((l) => l(req));
  });
}

export function resolveEdit(requestId: string, acceptedHunkIndices: number[]): ProposeEditResult | null {
  const pending = pendingEdits.get(requestId);
  if (!pending) {return null;}
  pendingEdits.delete(requestId);
  pending.resolve({ acceptedHunkIndices: new Set(acceptedHunkIndices) });
  return pending.result;
}

export function requestCommandApproval(command: string): Promise<boolean> {
  const requestId = randomUUID();
  return new Promise((resolve) => {
    pendingCommands.set(requestId, { resolve });
    commandListeners.forEach((l) => l({ requestId, command }));
  });
}

export function resolveCommand(requestId: string, approved: boolean): void {
  const pending = pendingCommands.get(requestId);
  if (!pending) {return;}
  pendingCommands.delete(requestId);
  pending.resolve(approved);
}

/** Reject every still-open request — called on deactivate() so a pending
 * tool call never hangs TrueForge forever if the extension is reloaded. */
export function rejectAllPending(): void {
  for (const [, pending] of pendingEdits) {pending.resolve({ acceptedHunkIndices: new Set() });}
  pendingEdits.clear();
  for (const [, pending] of pendingCommands) {pending.resolve(false);}
  pendingCommands.clear();
}

// ---------------------------------------------------------------------
// TrueForge-native approval path. TrueForge pauses the turn BEFORE it
// calls propose_edit / run_terminal_command (requireApprovalForTools in
// agents/coding-agent.json). The extension renders the review from the
// tool call's arguments, records the user's per-hunk decision here, and
// only then answers TrueForge with allow/deny. When the tool call
// arrives, the MCP handler consumes the recorded decision instead of
// asking again. If no decision was recorded (approval not configured on
// the TrueForge side), the handler falls back to the in-process gate
// above, so a write can never happen without a human decision.
// ---------------------------------------------------------------------
const decidedEdits = new Map<string, Set<number>>();
const approvedCommands = new Map<string, number>();
let writesBlocked = false;

function editKey(path: string, newContent: string): string {
  return path + "\0" + createHash("sha256").update(newContent).digest("hex");
}

export function recordEditDecision(path: string, newContent: string, accepted: Set<number>): void {
  decidedEdits.set(editKey(path, newContent), accepted);
}

export function takeEditDecision(path: string, newContent: string): Set<number> | undefined {
  const key = editKey(path, newContent);
  const decision = decidedEdits.get(key);
  decidedEdits.delete(key);
  return decision;
}

export function recordCommandApproval(command: string): void {
  approvedCommands.set(command, (approvedCommands.get(command) ?? 0) + 1);
}

export function takeCommandApproval(command: string): boolean {
  const n = approvedCommands.get(command) ?? 0;
  if (n === 0) {return false;}
  if (n === 1) {approvedCommands.delete(command);} else {approvedCommands.set(command, n - 1);}
  return true;
}

/** Set while no turn is running or after Cancel: late tool calls must not write. */
export function setWritesBlocked(blocked: boolean): void {
  writesBlocked = blocked;
  if (blocked) {
    decidedEdits.clear();
    approvedCommands.clear();
  }
}

export function writesAreBlocked(): boolean {
  return writesBlocked;
}
