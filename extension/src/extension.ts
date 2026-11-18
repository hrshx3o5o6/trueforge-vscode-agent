import * as vscode from "vscode";
import { startMcpServer, type McpServerHandle } from "./mcpServer/mcpServer.js";
import { invalidateRepoMapCache } from "./mcpServer/tools/repoMap.js";
import { createClient, type TrueForgeConfig } from "./trueforgeClient.js";
import { runTurnWithFallback } from "./resilience.js";
import { AgentPanel } from "./webview/agentPanel.js";
import type { TrueForge } from "@truefoundry/trueforge-sdk";

let mcpServerHandle: McpServerHandle | undefined;
let client: TrueForge | undefined;
let config: TrueForgeConfig | undefined;

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

  vscode.window.setStatusBarMessage(
    `TrueForge Agent: MCP tool server on ${config.mcpServerUrl} — register this URL in TrueForge Settings -> Connectors (no auth)`,
    10_000,
  );

  // Invalidate the cached repo_map whenever a file is saved — never
  // recomputed every turn, but must not go stale across a real edit.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => invalidateRepoMapCache()),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("trueforgeAgent.openPanel", () => {
      const panel = AgentPanel.createOrShow(context.extensionUri);
      wirePanel(panel, mcpServerHandle!);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("trueforgeAgent.inlineEdit", async () => {
      await handleInlineEdit();
    }),
  );
}

function wirePanel(panel: AgentPanel, mcp: McpServerHandle): void {
  mcp.onToolCall((name, args) => panel.post({ type: "tool_call", name, args }));

  let cancelled = false;

  panel.onMessage(async (raw) => {
    const message = raw as { type: string; text?: string };
    if (message.type === "cancel") {
      cancelled = true;
      return;
    }
    if (message.type !== "send" || !message.text || !client || !config) return;
    cancelled = false;

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
        if (cancelled) return; // best-effort local stop; see docs/SETUP.md known gaps re: true stream abort
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
  if (!instruction || !client || !config) return;

  const selectedText = editor.document.getText(editor.selection);
  const relativePath = vscode.workspace.asRelativePath(editor.document.uri);

  if (!config.primaryModel.name) {
    void vscode.window.showErrorMessage("No model configured (trueforgeAgent.primaryModel setting).");
    return;
  }

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
        () => {
          // Tool-call/delta events for inline edit are surfaced via the
          // Diff Review flow (Phase 3) once wired to TrueForge's
          // approval events — this command currently just drives the
          // turn; see docs/STATUS.md for what's left.
        },
        () => void vscode.window.showWarningMessage("Primary model failed — retrying with fallback."),
      );
    },
  );
}

export async function deactivate(): Promise<void> {
  await mcpServerHandle?.close();
}
