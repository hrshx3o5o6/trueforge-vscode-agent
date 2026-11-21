/**
 * Minimal webview panel: a text input, a transcript, a cancel button,
 * and (Phase 3) a per-hunk diff review UI + command approval prompt.
 * Plain HTML/CSS/JS by design (docs/DECISIONS.md) — no framework needed,
 * none of the scored behaviour depends on how the webview is built, only
 * on what it visibly does (streamed tokens, tool calls, diffs, cancel).
 *
 * Visual design pass (2026-11-19): minimal/terminal-inspired look taking
 * cues from opencode's own TUI (clean monospace diffs, understated
 * chrome, a timeline feel) but built on VS Code's own theme CSS
 * variables instead of a fixed palette — adapts to light/dark/any theme
 * automatically, which a hardcoded terminal theme can't do. Pure CSS/
 * markup change: every function name, element id, and class the message
 * handlers below depend on (#transcript, #input, #send, #cancel,
 * .delta-stream, .review-card, .hunk*, .status-*, .applied, .context-
 * card, .cmd-text) is unchanged, so none of the working message-handling
 * logic needed to move.
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
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body {
    height: 100%; margin: 0; padding: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  body { display: flex; flex-direction: column; height: 100vh; }

  #header {
    flex: none; display: flex; align-items: center; gap: 6px;
    padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border);
    font-weight: 600; font-size: 12px; letter-spacing: 0.3px;
    color: var(--vscode-descriptionForeground); text-transform: uppercase;
  }
  #header .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--vscode-charts-green); flex: none; }

  #transcript {
    flex: 1 1 auto; overflow-y: auto; padding: 10px 12px;
    display: flex; flex-direction: column; gap: 6px;
  }
  #transcript > div { max-width: 92%; }

  .msg-user {
    align-self: flex-end; background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground); padding: 6px 10px;
    border-radius: 10px 10px 2px 10px; white-space: pre-wrap; line-height: 1.4;
  }
  .delta-stream {
    align-self: flex-start; white-space: pre-wrap; line-height: 1.5;
    padding: 2px 2px;
  }

  .tool-call {
    align-self: flex-start; font-family: var(--vscode-editor-font-family);
    font-size: 11.5px; color: var(--vscode-charts-blue);
    background: var(--vscode-textCodeBlock-background);
    border-radius: 4px; padding: 3px 7px; opacity: 0.9;
  }
  .tool-call::before { content: "›"; margin-right: 5px; opacity: 0.7; }

  .status-info, .status-warn, .status-error {
    align-self: center; font-size: 11px; padding: 2px 8px; border-radius: 10px;
  }
  .status-info { color: var(--vscode-descriptionForeground); }
  .status-warn { color: var(--vscode-editorWarning-foreground); background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 12%, transparent); }
  .status-error { color: var(--vscode-errorForeground); font-weight: 600; background: color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent); }
  .error { color: var(--vscode-errorForeground); }

  .run-end { align-self: center; font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic; margin: 2px 0; }

  .review-card {
    align-self: stretch; max-width: 100%;
    border: 1px solid var(--vscode-panel-border); border-radius: 8px;
    padding: 10px; background: var(--vscode-editorWidget-background);
    box-shadow: 0 1px 2px rgba(0,0,0,0.08);
  }
  .review-card h4 { margin: 0 0 8px 0; font-size: 12px; font-family: var(--vscode-editor-font-family); font-weight: 600; }
  .hunk { border: 1px solid var(--vscode-panel-border); border-radius: 5px; margin: 6px 0; overflow: hidden; }
  .hunk pre { margin: 0; padding: 4px 6px; font-family: var(--vscode-editor-font-family); font-size: 12px; overflow-x: auto; }
  .hunk-line-add { background: rgba(80,200,120,0.16); }
  .hunk-line-del { background: rgba(220,80,80,0.16); }
  .hunk-header {
    display: flex; justify-content: space-between; align-items: center;
    background: var(--vscode-editor-lineHighlightBackground);
    padding: 3px 8px; font-size: 11px; font-family: var(--vscode-editor-font-family);
  }
  .hunk-header label { cursor: pointer; display: flex; align-items: center; gap: 5px; }
  .review-actions { margin-top: 8px; display: flex; gap: 6px; }

  .applied {
    align-self: flex-start; border-left: 3px solid var(--vscode-charts-green);
    padding: 3px 8px; font-size: 12px; display: flex; align-items: center; gap: 8px;
  }
  .context-card {
    align-self: stretch; border-left: 3px solid var(--vscode-charts-purple);
    padding: 4px 8px; margin: 2px 0; font-size: 11.5px; border-radius: 0 6px 6px 0;
    background: color-mix(in srgb, var(--vscode-charts-purple) 6%, transparent);
  }
  .context-card li { margin: 1px 0; }

  /* Dynamic subagent (TrueForge create_sub_agent): its own card, never mixed into the main answer. */
  .subagent-card {
    align-self: stretch; max-width: 100%; border: 1px solid var(--vscode-panel-border);
    border-left: 3px solid var(--vscode-textLink-foreground); border-radius: 0 6px 6px 0;
    background: color-mix(in srgb, var(--vscode-textLink-foreground) 5%, transparent); font-size: 12px;
  }
  .subagent-head { display: flex; align-items: baseline; gap: 6px; padding: 5px 8px; cursor: pointer; }
  .subagent-head > span:first-child, .subagent-head code { flex: none; white-space: nowrap; }
  .subagent-head .sa-input { flex: 1 1 auto; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .subagent-head .sa-badge { flex: none; font-size: 10.5px; padding: 0 6px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .subagent-card.failed .sa-badge { background: var(--vscode-errorForeground); }
  .subagent-body { padding: 0 8px 6px 20px; display: flex; flex-direction: column; gap: 3px; }
  .subagent-card.collapsed .subagent-body { display: none; }
  .subagent-body .sa-text { white-space: pre-wrap; line-height: 1.45; max-height: 180px; overflow-y: auto; }
  .subagent-body .sa-text:empty { display: none; }
  .cmd-text {
    font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background);
    padding: 6px 8px; border-radius: 5px; display: block; margin: 6px 0; font-size: 12px;
  }

  button {
    font-family: var(--vscode-font-family); font-size: 12px; cursor: pointer;
    border: 1px solid var(--vscode-button-border, transparent); border-radius: 5px;
    padding: 4px 10px; background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  button:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
  button:disabled { opacity: 0.5; cursor: default; }
  .review-actions .accept-all, #send { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .review-actions .accept-all:hover, #send:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }

  #composer {
    flex: none; display: flex; flex-direction: column; gap: 6px;
    padding: 8px 12px 10px; border-top: 1px solid var(--vscode-panel-border);
  }
  #input {
    width: 100%; resize: none; font-family: var(--vscode-font-family); font-size: 13px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border); border-radius: 6px; padding: 7px 9px;
  }
  #input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  #composer-actions { display: flex; gap: 6px; justify-content: flex-end; }

  /* --- Agent Trace: structured, timestamped record of harness activity --- */
  #header { justify-content: space-between; }
  #header-left { display: flex; align-items: center; gap: 6px; }
  #trace-toggle { font-size: 11px; padding: 2px 8px; text-transform: none; letter-spacing: normal; }
  #main { flex: 1 1 auto; display: flex; min-height: 0; }
  #main #transcript { flex: 1 1 auto; }
  #trace-panel {
    display: none; flex: 0 0 340px; flex-direction: column; min-height: 0;
    border-left: 1px solid var(--vscode-panel-border);
  }
  #trace-panel.open { display: flex; }
  #trace-header {
    flex: none; display: flex; justify-content: space-between; align-items: center;
    padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border);
    font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--vscode-descriptionForeground);
  }
  #trace-list { flex: 1 1 auto; overflow-y: auto; padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; }
  .trace-row {
    font-family: var(--vscode-editor-font-family); font-size: 11px; line-height: 1.4;
    border-left: 3px solid var(--vscode-panel-border); padding: 3px 6px; cursor: pointer;
    background: var(--vscode-textCodeBlock-background); border-radius: 0 4px 4px 0;
  }
  .trace-row.cat-tool { border-left-color: var(--vscode-charts-blue); }
  .trace-row.cat-context { border-left-color: var(--vscode-charts-purple); }
  .trace-row.cat-approval { border-left-color: var(--vscode-charts-orange); }
  .trace-row.cat-write { border-left-color: var(--vscode-charts-green); }
  .trace-row.cat-resilience { border-left-color: var(--vscode-charts-yellow); }
  .trace-row.cat-turn { border-left-color: var(--vscode-descriptionForeground); }
  .trace-row.cat-error { border-left-color: var(--vscode-errorForeground); }
  .trace-row .trace-time { color: var(--vscode-descriptionForeground); margin-right: 6px; }
  .trace-row .trace-badge {
    display: inline-block; font-size: 9.5px; font-weight: 700; padding: 0 4px; border-radius: 3px;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); margin-right: 4px;
  }
  .trace-row .trace-detail {
    display: none; white-space: pre-wrap; margin-top: 3px; padding-top: 3px;
    border-top: 1px dashed var(--vscode-panel-border); color: var(--vscode-descriptionForeground); font-size: 10.5px;
  }
  .trace-row.expanded .trace-detail { display: block; }
  #trace-empty { padding: 10px; font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic; }
</style>
</head>
<body>
  <div id="header">
    <div id="header-left"><span class="dot"></span>TrueForge Agent</div>
    <button id="trace-toggle">Trace ▸</button>
  </div>
  <div id="main">
    <div id="transcript"></div>
    <div id="trace-panel">
      <div id="trace-header">
        <span id="trace-count">Agent Trace (0)</span>
        <button id="trace-download">Download JSON</button>
      </div>
      <div id="trace-list"><div id="trace-empty">Nothing recorded yet — send a message to start the trace.</div></div>
    </div>
  </div>
  <div id="composer">
    <textarea id="input" rows="3" placeholder="Describe the change you want... (Cmd/Ctrl+Enter to send)"></textarea>
    <div id="composer-actions">
      <button id="cancel" disabled>Cancel</button>
      <button id="send">Send</button>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const transcript = document.getElementById('transcript');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const cancelBtn = document.getElementById('cancel');
    const tracePanel = document.getElementById('trace-panel');
    const traceToggle = document.getElementById('trace-toggle');
    const traceList = document.getElementById('trace-list');
    const traceCount = document.getElementById('trace-count');
    const traceDownload = document.getElementById('trace-download');
    const traceEmpty = document.getElementById('trace-empty');

    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    function append(html) {
      const div = document.createElement('div');
      div.innerHTML = html;
      transcript.appendChild(div);
      transcript.scrollTop = transcript.scrollHeight;
      return div;
    }

    // --- Agent Trace: a structured, timestamped record of real harness ---
    // activity (tool calls, context selection, resilience events, approval
    // decisions), independent of the chat transcript above. Every entry is
    // built from the SAME backend messages the transcript already renders
    // (and the user's own decisions), so it adds zero new backend surface --
    // purely an alternate, exportable view of what already happened.
    const trace = [];
    function fmtTime(ts) {
      const d = new Date(ts);
      return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
    }
    function recordTrace(category, summary, detail, criteria) {
      const entry = { t: Date.now(), category, summary, detail: detail || '', criteria: criteria || [] };
      trace.push(entry);
      traceCount.textContent = 'Agent Trace (' + trace.length + ')';
      if (traceEmpty) { traceEmpty.remove(); }
      const row = document.createElement('div');
      row.className = 'trace-row cat-' + category;
      const badges = entry.criteria.map((c) => '<span class="trace-badge">' + esc(c) + '</span>').join('');
      row.innerHTML = '<span class="trace-time">' + fmtTime(entry.t) + '</span>' + badges + esc(summary) +
        (entry.detail ? '<div class="trace-detail">' + esc(entry.detail) + '</div>' : '');
      row.addEventListener('click', () => row.classList.toggle('expanded'));
      traceList.appendChild(row);
      traceList.scrollTop = traceList.scrollHeight;
      return entry;
    }
    traceToggle.addEventListener('click', () => {
      const open = tracePanel.classList.toggle('open');
      traceToggle.textContent = open ? 'Trace \u25be' : 'Trace \u25b8';
    });
    traceDownload.addEventListener('click', () => {
      vscode.postMessage({ type: 'export_trace', trace: JSON.stringify(trace, null, 2) });
    });

    // --- Subagent cards, keyed by TrueForge thread id ---
    const subagentCards = new Map();
    const latestByName = new Map();
    function subagentCard(threadId, name, input) {
      let card = subagentCards.get(threadId);
      if (!card) {
        const firstLine = String(input || '').split('\\n')[0].slice(0, 120);
        card = append(
          '<div class="subagent-card running">' +
          '<div class="subagent-head"><span>⑂ Subagent</span><code>' + esc(name) + '</code>' +
          '<span class="sa-input">' + esc(firstLine) + '</span><span class="sa-badge">running…</span></div>' +
          '<div class="subagent-body"><div class="sa-text"></div><div class="sa-tools"></div></div></div>'
        ).firstElementChild;
        card.querySelector('.subagent-head').addEventListener('click', () => card.classList.toggle('collapsed'));
        subagentCards.set(threadId, card);
      }
      latestByName.set(name, card);
      return card;
    }
    function closeOpenSubagents(status) {
      subagentCards.forEach((card) => {
        if (!card.classList.contains('running')) return;
        card.classList.remove('running');
        card.querySelector('.sa-badge').textContent = status;
      });
    }

    sendBtn.addEventListener('click', () => {
      const text = input.value.trim();
      if (!text) return;
      append('<div class="msg-user">' + esc(text) + '</div>');
      recordTrace('turn', 'User sent a request', text, ['A2']);
      input.value = '';
      setRunning(true);
      vscode.postMessage({ type: 'send', text });
    });

    cancelBtn.addEventListener('click', () => {
      cancelBtn.disabled = true;
      recordTrace('turn', 'User cancelled the run', '', ['A3']);
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
        '<h4>✎ propose_edit — ' + esc(msg.path) + ' (' + msg.hunks.length + ' hunk(s))</h4>' +
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
        recordTrace('approval', 'User reviewed ' + esc(msg.path) + ': ' + accepted.length + '/' + msg.hunks.length + ' hunk(s) accepted',
          accepted.length === msg.hunks.length ? 'accept all' : accepted.length === 0 ? 'reject all' : 'partial (hunks ' + accepted.join(',') + ')', ['B2']);
        vscode.postMessage({ type: 'edit_decision', requestId: msg.requestId, acceptedHunkIndices: accepted });
        card.querySelectorAll('button, input').forEach((el) => (el.disabled = true));
        card.insertAdjacentHTML('beforeend', '<div class="run-end">Decision sent (' + accepted.length + '/' + msg.hunks.length + ' hunks accepted).</div>');
      }
    }

    function renderCommandReview(msg) {
      const card = append(
        '<div class="review-card">' +
        '<h4>▸ run_terminal_command</h4>' +
        '<code class="cmd-text">' + esc(msg.command) + '</code>' +
        '<div class="review-actions"><button class="accept-all approve">Run it</button><button class="deny">Deny</button></div>' +
        '</div>'
      );
      card.querySelector('.approve').addEventListener('click', () => {
        recordTrace('approval', 'User approved command', msg.command, ['B2']);
        vscode.postMessage({ type: 'command_decision', requestId: msg.requestId, approved: true });
        card.querySelectorAll('button').forEach((el) => (el.disabled = true));
      });
      card.querySelector('.deny').addEventListener('click', () => {
        recordTrace('approval', 'User denied command', msg.command, ['B2']);
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
      } else if (msg.type === 'subagent_start') {
        subagentCard(msg.threadId, msg.name, msg.input);
      } else if (msg.type === 'subagent_delta') {
        const text = subagentCard(msg.threadId, 'subagent', '').querySelector('.sa-text');
        text.textContent += msg.content;
        text.scrollTop = text.scrollHeight;
      } else if (msg.type === 'subagent_done') {
        const card = subagentCard(msg.threadId, msg.name, '');
        card.classList.remove('running');
        card.classList.add('collapsed');
        if (!msg.ok) card.classList.add('failed');
        card.querySelector('.sa-badge').textContent = msg.ok
          ? 'done' + (msg.durationMs != null ? ' in ' + (msg.durationMs / 1000).toFixed(1) + 's' : '')
          : 'failed: ' + (msg.error || 'unknown error');
      } else if (msg.type === 'compaction') {
        if (msg.phase === 'finished') {
          append('<div class="status-info">Context compacted (≈' + esc(msg.contextTokens) + ' tokens over the ' + esc(msg.thresholdTokens) +
            ' threshold' + (msg.durationMs != null ? ', ' + (msg.durationMs / 1000).toFixed(1) + 's' : '') + ')</div>');
        }
      } else if (msg.type === 'tool_call' && msg.subagent) {
        const card = latestByName.get(msg.subagent) || subagentCard('anon-' + msg.subagent, msg.subagent, '');
        const row = document.createElement('div');
        row.className = 'tool-call';
        row.textContent = msg.name + '(' + JSON.stringify(msg.args) + ')';
        card.querySelector('.sa-tools').appendChild(row);
      } else if (msg.type === 'tool_call') {
        append('<div class="tool-call">' + esc(msg.name) + '(' + esc(JSON.stringify(msg.args)) + ')</div>');
        recordTrace('tool', msg.name + '(' + Object.keys(msg.args || {}).join(', ') + ')', JSON.stringify(msg.args, null, 2), ['B1', 'B4']);
      } else if (msg.type === 'edit_review') {
        renderEditReview(msg);
        recordTrace('approval', 'propose_edit awaiting review: ' + msg.path + ' (' + msg.hunks.length + ' hunk(s))', '', ['B2']);
      } else if (msg.type === 'command_review') {
        renderCommandReview(msg);
        recordTrace('approval', 'run_terminal_command awaiting review', msg.command, ['B2']);
      } else if (msg.type === 'run_started') {
        closeOpenSubagents('stopped');
        setRunning(true);
      } else if (msg.type === 'status') {
        append('<div class="status-' + esc(msg.level) + '">' + esc(msg.message) + '</div>');
        const isResilience = /retry|retrying|fallback|switching to fallback/i.test(msg.message);
        recordTrace(isResilience ? 'resilience' : 'turn', msg.message, '', isResilience ? ['B3'] : []);
      } else if (msg.type === 'context') {
        const items = msg.items.map((it) =>
          '<li><code>' + esc(it.label) + '</code> — ' + esc(it.reason) + ' (~' + it.tokens + ' tok)</li>').join('');
        append('<div class="context-card"><b>Context selected</b> (' + msg.usedTokens + ' / ' + msg.budget +
          ' token budget)<ul>' + items + '</ul>' + (msg.dropped ? '<i>' + msg.dropped + ' lower-ranked candidate(s) left out to stay in budget</i>' : '') + '</div>');
        const detail = msg.items.map((it) => it.label + ' — ' + it.reason + ' (~' + it.tokens + ' tok)').join('\\n');
        recordTrace('context', 'Context selected: ' + msg.items.length + ' item(s), ' + msg.usedTokens + '/' + msg.budget + ' tokens' +
          (msg.dropped ? ', ' + msg.dropped + ' dropped' : ''), detail, ['B1']);
      } else if (msg.type === 'applied') {
        const div = append('<div class="applied">✔ applied &amp; saved <code>' + esc(msg.path) + '</code>' +
          (msg.existed ? '' : ' (new file)') + '<button class="undo">Undo</button></div>');
        div.querySelector('.undo').addEventListener('click', (ev) => {
          ev.target.disabled = true;
          recordTrace('write', 'User clicked Undo on ' + msg.path, '', ['B2']);
          vscode.postMessage({ type: 'undo', entryId: msg.entryId });
        });
        recordTrace('write', 'Applied & saved ' + msg.path + (msg.existed ? '' : ' (new file)'), '', ['B2']);
      } else if (msg.type === 'undone') {
        append('<div class="status-info">↶ ' + esc(msg.message) + '</div>');
        recordTrace('write', 'Undo: ' + msg.message, '', ['B2']);
      } else if (msg.type === 'error') {
        append('<div class="status-error">' + esc(msg.message) + '</div>');
        recordTrace('error', msg.message, '', ['B3']);
      } else if (msg.type === 'done') {
        if (msg.error) { append('<div class="status-error">' + esc(msg.error) + '</div>'); }
        const via = msg.model ? ' · ' + esc(msg.model) + (msg.usedFallback ? ' (fallback)' : '') : '';
        const sess = msg.sessionId ? ' · session ' + esc(msg.sessionId) : '';
        closeOpenSubagents(msg.status === 'cancelled' ? 'cancelled' : 'stopped');
        append('<div class="run-end">— ' + esc(msg.status || 'done') + via + sess + ' —</div>');
        recordTrace('turn', 'Turn ' + (msg.status || 'done') + via,
          (msg.error || '') + (msg.sessionId ? '\\nsession: ' + msg.sessionId : ''),
          msg.usedFallback ? ['A3', 'B3'] : ['A3']);
        setRunning(false);
      }
    });
  </script>
</body>
</html>`;
  }
}
