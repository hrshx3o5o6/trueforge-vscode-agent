/**
 * Minimal webview panel: a text input, a transcript, a cancel button,
 * and (Phase 3) a per-hunk diff review UI + command approval prompt.
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
  #transcript { white-space: pre-wrap; margin-bottom: 8px; max-height: 60vh; overflow-y: auto; }
  .tool-call { color: var(--vscode-charts-blue); font-style: italic; }
  .error { color: var(--vscode-errorForeground); }
  textarea { width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
  button { margin-top: 4px; }
  .review-card { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 8px; margin: 8px 0; background: var(--vscode-editorWidget-background); }
  .review-card h4 { margin: 0 0 6px 0; }
  .hunk { border: 1px solid var(--vscode-panel-border); margin: 6px 0; }
  .hunk pre { margin: 0; padding: 4px 6px; font-family: var(--vscode-editor-font-family); font-size: 12px; overflow-x: auto; }
  .hunk-line-add { background: rgba(80,200,120,0.18); }
  .hunk-line-del { background: rgba(220,80,80,0.18); }
  .hunk-header { display: flex; justify-content: space-between; align-items: center; background: var(--vscode-editor-lineHighlightBackground); padding: 2px 6px; font-size: 11px; }
  .hunk-header label { cursor: pointer; }
  .review-actions { margin-top: 6px; }
  .review-actions button { margin-right: 6px; }
  .cmd-text { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 4px; display: block; margin: 6px 0; }
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

    function esc(s) { return String(s).replace(/</g, '&lt;'); }

    function append(html) {
      const div = document.createElement('div');
      div.innerHTML = html;
      transcript.appendChild(div);
      transcript.scrollTop = transcript.scrollHeight;
      return div;
    }

    sendBtn.addEventListener('click', () => {
      const text = input.value.trim();
      if (!text) return;
      append('<div><b>You:</b> ' + esc(text) + '</div>');
      input.value = '';
      sendBtn.disabled = true;
      cancelBtn.disabled = false;
      vscode.postMessage({ type: 'send', text });
    });

    cancelBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
    });

    function renderHunk(hunk, index) {
      const lines = hunk.lines.map((l) => {
        const cls = l.startsWith('+') ? 'hunk-line-add' : l.startsWith('-') ? 'hunk-line-del' : '';
        return '<div class="' + cls + '">' + esc(l) + '</div>';
      }).join('');
      return '<div class="hunk">' +
        '<div class="hunk-header"><label><input type="checkbox" class="hunk-cb" data-index="' + index + '" checked> hunk ' + (index + 1) +
        ' (@@ -' + hunk.oldStart + ',' + hunk.oldLines + ' +' + hunk.newStart + ',' + hunk.newLines + ' @@)</label></div>' +
        '<pre>' + lines + '</pre></div>';
    }

    function renderEditReview(msg) {
      const card = append(
        '<div class="review-card">' +
        '<h4>propose_edit: ' + esc(msg.path) + ' (' + msg.hunks.length + ' hunk(s))</h4>' +
        msg.hunks.map(renderHunk).join('') +
        '<div class="review-actions">' +
        '<button class="accept-all">Accept all</button>' +
        '<button class="apply-selected">Apply selected</button>' +
        '<button class="reject-all">Reject all</button>' +
        '</div></div>'
      );
      const checkboxes = () => Array.from(card.querySelectorAll('.hunk-cb'));
      card.querySelector('.accept-all').addEventListener('click', () => {
        checkboxes().forEach((cb) => (cb.checked = true));
        submitEdit();
      });
      card.querySelector('.reject-all').addEventListener('click', () => {
        checkboxes().forEach((cb) => (cb.checked = false));
        submitEdit();
      });
      card.querySelector('.apply-selected').addEventListener('click', submitEdit);

      function submitEdit() {
        const accepted = checkboxes().filter((cb) => cb.checked).map((cb) => Number(cb.dataset.index));
        vscode.postMessage({ type: 'edit_decision', requestId: msg.requestId, acceptedHunkIndices: accepted });
        card.querySelectorAll('button, input').forEach((el) => (el.disabled = true));
        card.insertAdjacentHTML('beforeend', '<div><i>Decision sent (' + accepted.length + '/' + msg.hunks.length + ' hunks accepted).</i></div>');
      }
    }

    function renderCommandReview(msg) {
      const card = append(
        '<div class="review-card">' +
        '<h4>run_terminal_command</h4>' +
        '<code class="cmd-text">' + esc(msg.command) + '</code>' +
        '<div class="review-actions"><button class="approve">Run it</button><button class="deny">Deny</button></div>' +
        '</div>'
      );
      card.querySelector('.approve').addEventListener('click', () => {
        vscode.postMessage({ type: 'command_decision', requestId: msg.requestId, approved: true });
        card.querySelectorAll('button').forEach((el) => (el.disabled = true));
      });
      card.querySelector('.deny').addEventListener('click', () => {
        vscode.postMessage({ type: 'command_decision', requestId: msg.requestId, approved: false });
        card.querySelectorAll('button').forEach((el) => (el.disabled = true));
      });
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'delta') {
        const last = transcript.lastElementChild;
        if (last && last.classList.contains('delta-stream')) {
          last.innerHTML += esc(msg.content);
        } else {
          append('<div class="delta-stream">' + esc(msg.content) + '</div>');
        }
      } else if (msg.type === 'tool_call') {
        append('<div class="tool-call">[tool] ' + esc(msg.name) + '(' + esc(JSON.stringify(msg.args)) + ')</div>');
      } else if (msg.type === 'edit_review') {
        renderEditReview(msg);
      } else if (msg.type === 'command_review') {
        renderCommandReview(msg);
      } else if (msg.type === 'fallback') {
        append('<div class="error">[primary model failed — retrying with fallback model]</div>');
      } else if (msg.type === 'error') {
        append('<div class="error">[error] ' + esc(msg.message) + '</div>');
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
