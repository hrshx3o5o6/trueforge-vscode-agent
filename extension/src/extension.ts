import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import type { TrueForge } from "@truefoundry/trueforge-sdk";
import { startMcpServer, type McpServerHandle } from "./mcpServer/mcpServer.js";
import { invalidateRepoMapCache } from "./mcpServer/tools/repoMap.js";
import { proposeEdit } from "./mcpServer/tools/proposeEdit.js";
import {
  resolveEdit,
  resolveCommand,
  rejectAllPending,
  requestEditApproval,
  requestCommandApproval,
  recordEditDecision,
  recordCommandApproval,
  setWritesBlocked,
} from "./mcpServer/approvalRegistry.js";
import { beginTurn, rollbackTurn, undoEntry, onApplied } from "./mcpServer/editJournal.js";
import { createClient, loadAgentDefinition, type TrueForgeConfig } from "./trueforgeClient.js";
import { ensureConnector } from "./trueforgeSetup.js";
import { TurnController, type ApprovalAnswer, type ApprovalRequest } from "./turnRunner.js";
import { AgentPanel } from "./webview/agentPanel.js";
import { ProposedContentProvider, PROPOSED_SCHEME } from "./diffPreview.js";
import { assembleContext, type ContextItem } from "./contextAssembler.js";

let mcpServerHandle: McpServerHandle | undefined;
let client: TrueForge | undefined;
let config: TrueForgeConfig | undefined;
let extensionUri: vscode.Uri;
/** The chat panel's TrueForge session, reused across Sends so history is kept. */
let chatSessionId: string | undefined;
/** The one run allowed at a time (agent mode or inline edit). */
let activeRun: { controller: TurnController; turn: number } | undefined;
const proposedDocs = new ProposedContentProvider();

function loadConfig(): TrueForgeConfig {
  const settings = vscode.workspace.getConfiguration("trueforgeAgent");
  return {
    baseUrl: settings.get<string>("baseUrl", "http://localhost:8790"),
    token: settings.get<string>("token") || undefined,
    primaryModel: { name: settings.get<string>("primaryModel", "") },
    fallbackModel: settings.get<string>("fallbackModel") ? { name: settings.get<string>("fallbackModel")! } : undefined,
    mcpServerUrl: config?.mcpServerUrl ?? "",
    contextTokenBudget: settings.get<number>("contextTokenBudget", 6000),
    maxRetries: settings.get<number>("maxRetries", 2),
    stallTimeoutSeconds: settings.get<number>("stallTimeoutSeconds", 90),
  };
}

function panel(): AgentPanel {
  const p = AgentPanel.createOrShow(extensionUri);
  p.onMessage((m) => void onPanelMessage(m));
  return p;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  extensionUri = context.extensionUri;
  config = loadConfig();
  client = createClient(config);
  const agentDef = loadAgentDefinition(context.extensionPath);
  setWritesBlocked(true); // nothing may write until a run starts

  const port = vscode.workspace.getConfiguration("trueforgeAgent").get<number>("mcpServerPort", 4790);
  const mcpAuthToken = randomBytes(24).toString("hex");
  mcpServerHandle = await startMcpServer(port, mcpAuthToken);
  config.mcpServerUrl = `http://127.0.0.1:${mcpServerHandle.port}/mcp`;
  context.subscriptions.push({ dispose: () => void mcpServerHandle?.close() });
  context.subscriptions.push({ dispose: () => rejectAllPending() });
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(PROPOSED_SCHEME, proposedDocs));

  // Register this window's MCP server with TrueForge (no manual
  // Settings -> Connectors step). Non-blocking so a TrueForge that isn't
  // up yet doesn't stop activation.
  void ensureConnector({
    baseUrl: config.baseUrl,
    token: config.token,
    name: agentDef.mcpServer.name,
    description: agentDef.mcpServer.description,
    mcpUrl: config.mcpServerUrl,
    mcpAuthToken,
  }).then(
    () => vscode.window.setStatusBarMessage(`TrueForge Agent: tools connected (${config!.mcpServerUrl})`, 8_000),
    (err: Error) => void vscode.window.showErrorMessage(`TrueForge Agent: ${err.message}`),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => invalidateRepoMapCache()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("trueforgeAgent")) {
        config = loadConfig();
        client = createClient(config);
      }
    }),
  );

  // Review requests (native-approval path and in-process fallback path
  // both go through approvalRegistry) are rendered in the panel, with the
  // full diff also opened in a real diff editor.
  mcpServerHandle.onEditProposed((req) => {
    panel().post({ type: "edit_review", requestId: req.requestId, path: req.path, hunks: req.hunks });
  });
  mcpServerHandle.onCommandProposed((req) => {
    panel().post({ type: "command_review", requestId: req.requestId, command: req.command });
  });
  mcpServerHandle.onToolCall((name, args) => AgentPanel.current?.post({ type: "tool_call", name, args }));
  onApplied((e) => {
    const added = e.after.split("\n").length - (e.existed ? e.before.split("\n").length : 0);
    AgentPanel.current?.post({ type: "applied", entryId: e.id, path: e.path, existed: e.existed, lineDelta: added });
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("trueforgeAgent.openPanel", () => {
      const isNew = !AgentPanel.current;
      panel();
      if (isNew) {chatSessionId = undefined;}
    }),
    vscode.commands.registerCommand("trueforgeAgent.inlineEdit", () => handleInlineEdit()),
    vscode.commands.registerCommand("trueforgeAgent.cancel", () => cancelActiveRun()),
  );
}

async function onPanelMessage(raw: unknown): Promise<void> {
  const m = raw as { type: string; text?: string; requestId?: string; acceptedHunkIndices?: number[]; approved?: boolean; entryId?: number };
  switch (m.type) {
    case "edit_decision":
      if (m.requestId) {resolveEdit(m.requestId, m.acceptedHunkIndices ?? []);}
      return;
    case "command_decision":
      if (m.requestId) {resolveCommand(m.requestId, !!m.approved);}
      return;
    case "cancel":
      await cancelActiveRun();
      return;
    case "undo":
      if (m.entryId !== undefined) {
        const msg = await undoEntry(m.entryId).catch((e: Error) => `Undo failed: ${e.message}`);
        AgentPanel.current?.post({ type: "undone", entryId: m.entryId, message: msg });
      }
      return;
    case "send":
      if (m.text) {await runChat(m.text);}
      return;
  }
}

async function cancelActiveRun(): Promise<void> {
  const run = activeRun;
  if (!run) {return;}
  setWritesBlocked(true);
  rejectAllPending();
  await run.controller.cancel();
  const restored = await rollbackTurn(run.turn);
  AgentPanel.current?.post({
    type: "status",
    level: "warn",
    message: `Cancelled. ${restored.length ? `Rolled back ${restored.join(", ")}.` : "No files were changed."}`,
  });
}

/** Turns a TrueForge approval request into the editor's review UI and back. */
async function reviewToolCall(req: ApprovalRequest): Promise<ApprovalAnswer> {
  if (req.toolName === "propose_edit") {
    const path = String(req.args.path ?? "");
    const newContent = String(req.args.new_content ?? "");
    const result = await proposeEdit(path, newContent);
    if (result.hunks.length === 0) {return { allow: true };}
    const preview = await proposedDocs.openDiff(result.path, newContent);
    const decision = await requestEditApproval(result).finally(() => void proposedDocs.closeDiff(preview));
    recordEditDecision(result.path, newContent, decision.acceptedHunkIndices);
    return decision.acceptedHunkIndices.size > 0
      ? { allow: true }
      : { allow: false, reason: `The user rejected every hunk for ${result.path}. No changes were made.` };
  }
  const command = req.toolName === "run_terminal_command" ? String(req.args.command ?? "") : `${req.toolName} ${JSON.stringify(req.args)}`;
  const approved = await requestCommandApproval(command);
  if (approved && req.toolName === "run_terminal_command") {recordCommandApproval(command);}
  return approved ? { allow: true } : { allow: false, reason: `The user declined: ${command}` };
}

interface RunOptions {
  prompt: string;
  sessionId?: string;
  onDelta?: (text: string) => void;
}

async function runRequest(opts: RunOptions): Promise<{ status: string; error?: string; sessionId?: string }> {
  const refuse = (error: string) => {
    AgentPanel.current?.post({ type: "done", status: "failed", usedFallback: false, error });
    return { status: "failed", error };
  };
  if (!client || !config) {return refuse("Extension not initialised.");}
  if (activeRun) {return refuse("A run is already in progress — cancel it first.");}
  if (!config.primaryModel.name) {
    return refuse("No model configured. Set trueforgeAgent.primaryModel to a model name listed in TrueForge (Settings -> Models).");
  }
  const p = panel();
  const turn = beginTurn();
  const controller = new TurnController(client, {
    onDelta: (t) => { p.post({ type: "delta", content: t }); opts.onDelta?.(t); },
    onToolCall: () => undefined, // the MCP server reports actual executions (onToolCall above)
    onStatus: (message, level) => p.post({ type: "status", level, message }),
    onApproval: reviewToolCall,
    beforeRetry: async () => {
      rejectAllPending();
      const restored = await rollbackTurn(turn);
      if (restored.length) {p.post({ type: "status", level: "info", message: `Rolled back partial edits: ${restored.join(", ")}` });}
    },
  });
  activeRun = { controller, turn };
  setWritesBlocked(false);
  void vscode.commands.executeCommand("setContext", "trueforgeAgent.running", true);
  p.post({ type: "run_started" });
  try {
    const result = await controller.run(opts.prompt, {
      primary: config.primaryModel,
      fallback: config.fallbackModel,
      maxRetries: config.maxRetries,
      stallTimeoutSeconds: config.stallTimeoutSeconds,
      sessionId: opts.sessionId,
    });
    const error = result.status === "failed"
      ? `All configured models failed: ${result.error}. No files were changed.`
      : undefined;
    p.post({ type: "done", status: result.status, usedFallback: result.usedFallback, model: result.model, sessionId: result.sessionId, error });
    return { status: result.status, error, sessionId: result.sessionId };
  } finally {
    setWritesBlocked(true);
    rejectAllPending();
    activeRun = undefined;
    void vscode.commands.executeCommand("setContext", "trueforgeAgent.running", false);
  }
}

/** Assembles the <context> block and shows the selection in the panel. */
async function withContext(request: string, opts: { extra?: ContextItem[]; autoRetrieve?: boolean }): Promise<string> {
  try {
    const ctx = await assembleContext(request, config?.contextTokenBudget ?? 6000, opts);
    if (ctx.items.length) {
      panel().post({
        type: "context",
        items: ctx.items.map(({ label, reason, tokens }) => ({ label, reason, tokens })),
        usedTokens: ctx.usedTokens,
        budget: ctx.budget,
        dropped: ctx.dropped,
      });
    }
    return ctx.block;
  } catch (err) {
    panel().post({ type: "status", level: "warn", message: `Context assembly skipped: ${(err as Error).message}` });
    return "";
  }
}

async function runChat(text: string): Promise<void> {
  const block = activeRun ? "" : await withContext(text, { autoRetrieve: true });
  const result = await runRequest({ prompt: block + text, sessionId: chatSessionId });
  if (result.sessionId) {chatSessionId = result.sessionId;}
}

async function handleInlineEdit(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showWarningMessage("Select some code first.");
    return;
  }
  const instruction = await vscode.window.showInputBox({
    prompt: "What should change about the selected code?",
    placeHolder: "e.g. Treat 'off' and 'n' as false too, case-insensitively",
  });
  if (!instruction) {return;}

  const doc = editor.document;
  const sel = editor.selection;
  const relativePath = vscode.workspace.asRelativePath(doc.uri, false);
  if (doc.isDirty) {await doc.save();}
  const prompt =
    `INLINE EDIT of ${relativePath}, lines ${sel.start.line + 1}-${sel.end.line + 1} (the user's selection):\n` +
    "```\n" + doc.getText(sel) + "\n```\n" +
    `Instruction: ${instruction}\n\n` +
    `Change only what the instruction requires, within or directly tied to the selection. ` +
    `Read ${relativePath} with read_file (a line range is enough) only if you need surrounding code, ` +
    `then call propose_edit once with the full new content of ${relativePath}. Do not edit other files.`;

  // Inline edit: only explicit @mentions in the instruction, no automatic
  // retrieval — the selection is the context, and the edit is single-file.
  const block = await withContext(instruction, { autoRetrieve: false });

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "TrueForge inline edit", cancellable: true },
    async (progress, token) => {
      token.onCancellationRequested(() => void cancelActiveRun());
      progress.report({ message: "waiting for the model… (diff opens for review)" });
      const result = await runRequest({ prompt: block + prompt });
      if (result.status === "failed") {
        void vscode.window.showErrorMessage(`TrueForge inline edit failed: ${result.error ?? "unknown error"}`);
      } else if (result.status === "cancelled") {
        void vscode.window.showInformationMessage("Inline edit cancelled — no changes were made.");
      }
    },
  );
}

export async function deactivate(): Promise<void> {
  await activeRun?.controller.cancel();
  rejectAllPending();
  await mcpServerHandle?.close();
}
