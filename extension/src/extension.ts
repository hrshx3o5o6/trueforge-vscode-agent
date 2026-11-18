import * as vscode from "vscode";
import { startMcpServer, type McpServerHandle } from "./mcpServer/mcpServer.js";
import { invalidateRepoMapCache } from "./mcpServer/tools/repoMap.js";
import { resolveEdit, resolveCommand, rejectAllPending } from "./mcpServer/approvalRegistry.js";
import { createClient, type TrueForgeConfig } from "./trueforgeClient.js";
import { runTurnWithFallback } from "./resilience.js";
import { AgentPanel } from "./webview/agentPanel.js";
import type { TrueForge } from "@truefoundry/trueforge-sdk";

let mcpServerHandle: McpServerHandle | undefined;
let client: TrueForge | undefined;
let config: TrueForgeConfig | undefined;
/** Module-level (not per-wirePanel-call) so a re-wire triggered by an
 * approval arriving mid-turn (wireApprovalRelay calls wirePanel again to
 * guarantee the handler is attached) never orphans an in-flight turn's
 * cancel flag in a stale closure. */
let turnCancelled = false;

function loadConfig(): TrueForgeConfig {
  const settings = vscode.workspace.getConfiguration("trueforgeAgent");
  return {
    baseUrl: settings.get<string>("baseUrl", "http://localhost:8790"),
    token: settings.get<string>("token") || undefined,
    primaryModel: { name: settings.get<string>("primaryModel", "") },
    fallbackModel: settings.get<string>("fallbackModel")
      ? { name: settings.get<string>("fallbackModel")! }
      : undefined,
    mcpServerUrl: "", // filled in once the local server has a port
  };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  config = loadConfig();
  client = createClient(config);

  const port = vscode.workspace.getConfiguration("trueforgeAgent").get<number>("mcpServerPort", 4790);
  mcpServerHandle = await startMcpServer(port);
  config.mcpServerUrl = `http://127.0.0.1:${mcpServerHandle.port}/mcp`;
  context.subscriptions.push({ dispose: () => void mcpServerHandle?.close() });
  context.subscriptions.push({ dispose: () => rejectAllPending() });

  vscode.window.setStatusBarMessage(
    `TrueForge Agent: MCP tool server on ${config.mcpServerUrl} — register this URL in TrueForge Settings -> Connectors (no auth)`,
    10_000,
  );

  // Invalidate the cached repo_map whenever a file is saved — never
  // recomputed every turn, but must not go stale across a real edit.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => invalidateRepoMapCache()),
  );

  // Approval relay is registered once, independent of whether the chat
  // panel is currently open — a review must never be silently dropped
  // just because the user closed the panel after kicking off a turn
  // (e.g. via inlineEdit). It auto-reveals the panel when needed.
  wireApprovalRelay(mcpServerHandle, context);

  // Registered once (not inside wirePanel, which can run multiple times
  // across openPanel/inlineEdit/approval-relay calls) — dispatches to
  // whichever AgentPanel instance is currently live, so tool-call log
  // lines are never duplicated by repeated wirePanel() calls.
  mcpServerHandle.onToolCall((name, args) => AgentPanel.current?.post({ type: "tool_call", name, args }));

  context.subscriptions.push(
    vscode.commands.registerCommand("trueforgeAgent.openPanel", () => {
      const panel = AgentPanel.createOrShow(context.extensionUri);
      wirePanel(panel);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("trueforgeAgent.inlineEdit", async () => {
      await handleInlineEdit(context);
    }),
  );
}

/** Phase 3: relays propose_edit / run_terminal_command review requests
 * from the MCP server into the webview, and relays the user's decision
 * back into approvalRegistry so the blocked tool call can resolve. */
function wireApprovalRelay(mcp: McpServerHandle, context: vscode.ExtensionContext): void {
  const getPanel = (): AgentPanel => {
    const panel = AgentPanel.createOrShow(context.extensionUri);
    // wirePanel() is idempotent to call repeatedly (it just re-sets the
    // panel's single onMessage handler, which always includes the
    // approval check first) — safe whether or not openPanel already ran.
    wirePanel(panel);
    return panel;
  };

  mcp.onEditProposed((req) => {
    const panel = getPanel();
    panel.post({ type: "edit_review", requestId: req.requestId, path: req.path, hunks: req.hunks });
  });

  mcp.onCommandProposed((req) => {
    const panel = getPanel();
    panel.post({ type: "command_review", requestId: req.requestId, command: req.command });
  });
}

function resolveApprovalMessage(raw: unknown): boolean {
  const message = raw as { type: string; requestId?: string; acceptedHunkIndices?: number[]; approved?: boolean };
  if (message.type === "edit_decision" && message.requestId) {
    resolveEdit(message.requestId, message.acceptedHunkIndices ?? []);
    return true;
  }
  if (message.type === "command_decision" && message.requestId) {
    resolveCommand(message.requestId, !!message.approved);
    return true;
  }
  return false;
}

function wirePanel(panel: AgentPanel): void {
  panel.onMessage(async (raw) => {
    if (resolveApprovalMessage(raw)) {return;}

    const message = raw as { type: string; text?: string };
    if (message.type === "cancel") {
      turnCancelled = true;
      return;
    }
    if (message.type !== "send" || !message.text || !client || !config) {return;}
    turnCancelled = false;

    if (!config.primaryModel.name) {
      panel.post({
        type: "error",
        message:
          "No model configured. Set trueforgeAgent.primaryModel in VS Code settings to a model name configured in TrueForge.",
      });
      return;
    }

    const result = await runTurnWithFallback(
      client,
      config.primaryModel,
      config.fallbackModel,
      message.text,
      (event) => {
        if (turnCancelled) {return;} // best-effort local stop; see docs/SETUP.md known gaps re: true stream abort
        const e = event as { type?: string; content?: string; name?: string; args?: unknown };
        if (e.type === "model.message.delta" && e.content) {
          panel.post({ type: "delta", content: e.content });
        } else if (e.type === "tool.call" && e.name) {
          panel.post({ type: "tool_call", name: e.name, args: e.args });
        }
      },
      () => panel.post({ type: "fallback" }),
    );

    panel.post({ type: "done", usedFallback: result.usedFallback, error: result.error });
  });
}

async function handleInlineEdit(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showWarningMessage("Select some code first.");
    return;
  }
  const instruction = await vscode.window.showInputBox({
    prompt: "What should change about the selected code?",
    placeHolder: "e.g. Treat 'off' and 'n' as false too, case-insensitively",
  });
  if (!instruction || !client || !config) {return;}

  const selectedText = editor.document.getText(editor.selection);
  const relativePath = vscode.workspace.asRelativePath(editor.document.uri);

  if (!config.primaryModel.name) {
    void vscode.window.showErrorMessage("No model configured (trueforgeAgent.primaryModel setting).");
    return;
  }

  // Inline edit reuses the same chat panel + approval relay for its
  // propose_edit review — opening it here means the user sees the
  // per-hunk diff card even if they triggered this from the editor
  // context menu / Cmd+K, never the chat flow.
  const panel = AgentPanel.createOrShow(context.extensionUri);
  wirePanel(panel);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "TrueForge Agent is editing..." },
    async () => {
      const prompt =
        `In ${relativePath}, change this selected code:\n\n${selectedText}\n\n` +
        `Instruction: ${instruction}\n\n` +
        `Call propose_edit with the full new content of ${relativePath}; this is a single-file inline edit, don't explore other files.`;

      await runTurnWithFallback(
        client!,
        config!.primaryModel,
        config!.fallbackModel,
        prompt,
        (event) => {
          const e = event as { type?: string; name?: string; args?: unknown };
          if (e.type === "tool.call" && e.name) {panel.post({ type: "tool_call", name: e.name, args: e.args });}
        },
        () => void vscode.window.showWarningMessage("Primary model failed — retrying with fallback."),
      );
    },
  );
}

export async function deactivate(): Promise<void> {
  rejectAllPending();
  await mcpServerHandle?.close();
}
