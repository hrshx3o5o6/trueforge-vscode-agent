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
  .status-info { color: var(--vscode-descriptionForeground); }
  .status-warn { color: var(--vscode-editorWarning-foreground); }
  .status-error { color: var(--vscode-errorForeground); font-weight: 600; }
  .applied { border-left: 3px solid var(--vscode-charts-green); padding: 2px 6px; margin: 4px 0; }
  .applied button { margin-left: 8px; }
  .context-card { border-left: 3px solid var(--vscode-charts-purple); padding: 2px 6px; margin: 6px 0; font-size: 12px; }
  .context-card li { margin: 1px 0; }
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

    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

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
      setRunning(true);
      vscode.postMessage({ type: 'send', text });
    });

    cancelBtn.addEventListener('click', () => {
      cancelBtn.disabled = true;
      vscode.postMessage({ type: 'cancel' });
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { sendBtn.click(); }
    });

    function setRunning(running) {
      sendBtn.disabled = running;
      cancelBtn.disabled = !running;
    }

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
      } else if (msg.type === 'run_started') {
        setRunning(true);
      } else if (msg.type === 'status') {
        append('<div class="status-' + esc(msg.level) + '">[' + esc(msg.level) + '] ' + esc(msg.message) + '</div>');
      } else if (msg.type === 'context') {
        const items = msg.items.map((it) =>
          '<li><code>' + esc(it.label) + '</code> — ' + esc(it.reason) + ' (~' + it.tokens + ' tok)</li>').join('');
        append('<div class="context-card"><b>Context selected</b> (' + msg.usedTokens + ' / ' + msg.budget +
          ' token budget)<ul>' + items + '</ul>' + (msg.dropped ? '<i>' + msg.dropped + ' lower-ranked candidate(s) left out to stay in budget</i>' : '') + '</div>');
      } else if (msg.type === 'applied') {
        const div = append('<div class="applied">✔ applied &amp; saved <code>' + esc(msg.path) + '</code>' +
          (msg.existed ? '' : ' (new file)') + '<button class="undo">Undo</button></div>');
        div.querySelector('.undo').addEventListener('click', (ev) => {
          ev.target.disabled = true;
          vscode.postMessage({ type: 'undo', entryId: msg.entryId });
        });
      } else if (msg.type === 'undone') {
        append('<div class="status-info">↶ ' + esc(msg.message) + '</div>');
      } else if (msg.type === 'error') {
        append('<div class="status-error">[error] ' + esc(msg.message) + '</div>');
      } else if (msg.type === 'done') {
        if (msg.error) { append('<div class="status-error">' + esc(msg.error) + '</div>'); }
        const via = msg.model ? ' · model ' + esc(msg.model) + (msg.usedFallback ? ' (fallback)' : '') : '';
        const sess = msg.sessionId ? ' · TrueForge session ' + esc(msg.sessionId) : '';
        append('<div><i>--- run ' + esc(msg.status || 'done') + via + sess + ' ---</i></div>');
        setRunning(false);
      }
    });
  </script>
</body>
</html>`;
  }
}
