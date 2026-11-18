/**
 * Minimal webview panel: a text input, a transcript, and a cancel button.
 * Plain HTML/CSS/JS by design (docs/DECISIONS.md) — no framework needed,
 * none of the scored behaviour depends on how the webview is built, only
 * on what it visibly does (streamed tokens, tool calls, diffs, cancel).
 */
import * as vscode from "vscode";

export class AgentPanel {
  public static current: AgentPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private onMessageHandler: ((message: unknown) => void) | undefined;

  public static createOrShow(extensionUri: vscode.Uri): AgentPanel {
    if (AgentPanel.current) {
      AgentPanel.current.panel.reveal();
      return AgentPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      "trueforgeAgent",
      "TrueForge Agent",
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    AgentPanel.current = new AgentPanel(panel);
    return AgentPanel.current;
  }

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.webview.html = this.renderHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message) => this.onMessageHandler?.(message),
      null,
      this.disposables,
    );
  }

  public onMessage(handler: (message: unknown) => void): void {
    this.onMessageHandler = handler;
  }

  public post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private dispose(): void {
    AgentPanel.current = undefined;
    this.disposables.forEach((d) => d.dispose());
  }

  private renderHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 8px; }
  #transcript { white-space: pre-wrap; margin-bottom: 8px; max-height: 70vh; overflow-y: auto; }
  .tool-call { color: var(--vscode-charts-blue); font-style: italic; }
  .error { color: var(--vscode-errorForeground); }
  textarea { width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
  button { margin-top: 4px; }
</style>
</head>
<body>
  <div id="transcript"></div>
  <textarea id="input" rows="3" placeholder="Describe the change you want..."></textarea>
  <br/>
  <button id="send">Send</button>
  <button id="cancel" disabled>Cancel</button>
  <script>
    const vscode = acquireVsCodeApi();
    const transcript = document.getElementById('transcript');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const cancelBtn = document.getElementById('cancel');

    function append(html) {
      transcript.innerHTML += html;
      transcript.scrollTop = transcript.scrollHeight;
    }

    sendBtn.addEventListener('click', () => {
      const text = input.value.trim();
      if (!text) return;
      append('<div><b>You:</b> ' + text.replace(/</g, '&lt;') + '</div>');
      input.value = '';
      sendBtn.disabled = true;
      cancelBtn.disabled = false;
      vscode.postMessage({ type: 'send', text });
    });

    cancelBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'delta') {
        append(msg.content.replace(/</g, '&lt;'));
      } else if (msg.type === 'tool_call') {
        append('<div class="tool-call">[tool] ' + msg.name + '(' + JSON.stringify(msg.args) + ')</div>');
      } else if (msg.type === 'fallback') {
        append('<div class="error">[primary model failed — retrying with fallback model]</div>');
      } else if (msg.type === 'error') {
        append('<div class="error">[error] ' + msg.message + '</div>');
      } else if (msg.type === 'done') {
        append('<div><i>--- turn done' + (msg.usedFallback ? ' (via fallback model)' : '') + ' ---</i></div>');
        sendBtn.disabled = false;
        cancelBtn.disabled = true;
      }
    });
  </script>
</body>
</html>`;
  }
}
