#!/usr/bin/env python3
"""Build docs/WRITEUP.docx: clean, no horizontal rule lines, no scorecard/timestamps,
no AI-assistant naming in section 7."""
from docx import Document
from docx.shared import Pt, Inches, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

BASE = "/Users/harsha/Projects/trueforge-vscode-agent"

def set_no_border_table(table):
    tbl = table._tbl
    tblPr = tbl.tblPr
    borders = OxmlElement('w:tblBorders')
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        el = OxmlElement(f'w:{edge}')
        el.set(qn('w:val'), 'none')
        el.set(qn('w:sz'), '0')
        el.set(qn('w:space'), '0')
        el.set(qn('w:color'), 'auto')
        borders.append(el)
    tblPr.append(borders)

def shade_cell(cell, color_hex):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), color_hex)
    tcPr.append(shd)

def add_mono(paragraph, text):
    run = paragraph.add_run(text)
    run.font.name = 'Menlo'
    r = run._element
    rPr = r.get_or_add_rPr()
    rFonts = OxmlElement('w:rFonts')
    rFonts.set(qn('w:ascii'), 'Menlo')
    rFonts.set(qn('w:hAnsi'), 'Menlo')
    rPr.append(rFonts)
    run.font.size = Pt(9.5)
    return run

def h2(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(16)
    p.paragraph_format.space_after = Pt(4)
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(13)
    run.font.color.rgb = RGBColor(0x1a, 0x1a, 0x1a)
    return p

def body(doc, text_parts):
    """text_parts: list of (text, bold, mono) tuples"""
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.line_spacing = 1.25
    for text, bold, mono in text_parts:
        if mono:
            r = add_mono(p, text)
        else:
            r = p.add_run(text)
            r.font.size = Pt(10.5)
        r.bold = bold
    return p

def flag(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(8)
    pPr = p._p.get_or_add_pPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:fill'), 'FFF3BF')
    pPr.append(shd)
    r = p.add_run(text)
    r.italic = True
    r.font.size = Pt(9.5)
    return p

doc = Document()
section = doc.sections[0]
section.page_width = Cm(21.0)
section.page_height = Cm(29.7)
section.left_margin = Cm(2.2)
section.right_margin = Cm(2.2)
section.top_margin = Cm(1.8)
section.bottom_margin = Cm(1.8)

style = doc.styles['Normal']
style.font.name = 'Calibri'
style.font.size = Pt(10.5)

# Title
p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(2)
r = p.add_run("TrueForge VS Code Agent \u2014 Techfest 2026-27 Forge-a-thon")
r.bold = True
r.font.size = Pt(18)

p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(16)
r = p.add_run("Team dihhbug  \u00b7  Round 1 submission  \u00b7  Repo: github.com/hrshx3o5o6/trueforge-vscode-agent")
r.font.size = Pt(10)
r.font.color.rgb = RGBColor(0x55, 0x55, 0x55)

# 1. Team
h2(doc, "1. Team")
body(doc, [("Harshavardhan Kangala Dayanand \u2014 VIT Vellore, CS undergrad \u2014 hkangala@gmail.com \u2014 GitHub: ", False, False), ("hrshx3o5o6", False, True)])
flag(doc, "TODO before final submission: add remaining team member names / college / GitHub handles here if \u201cdihhbug\u201d is not a solo submission.")

# 2. Starting point
h2(doc, "2. Starting point")
body(doc, [
    ("Forked ", False, False), ("sst/opencode", False, True), (", subdirectory ", False, False), ("sdks/vscode/", False, True),
    (", commit ", False, False), ("521ceac004e59fbbfca0929596107cd8430f2b26", False, True),
    (". The official extension is a thin terminal launcher; we built the webview chat/diff-review UI and the entire TrueForge SDK integration ourselves on top of its activation scaffolding. ", False, False),
    ("The upstream extension's own agent loop was removed entirely", True, False),
    (" \u2014 every action the agent takes runs through a TrueForge session, never a direct model-provider call.", False, False),
])

# 3. Architecture
h2(doc, "3. Architecture on TrueForge")
body(doc, [
    ("The extension's webview panel sends user turns to TrueForge's SDK (", False, False), ("sessions.createTurnStream", False, True),
    ("), which streams back model text and tool-call events. Editor capabilities are exposed to the agent as real MCP tools served by an in-process MCP server (it needs ", False, False),
    ("vscode.*", False, True), (" symbol/definition APIs, so it cannot run standalone) \u2014 the agent decides what to read/edit, not our extension code.", False, False),
])
doc.add_picture(f"{BASE}/docs/diagrams/png/architecture.png", width=Inches(6.2))
doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
body(doc, [
    ("The six MCP tools: ", True, False),
    ("repo_map", False, True), (", ", False, False), ("search_code", False, True), (", ", False, False), ("read_file", False, True),
    (" (read-only) and ", False, False), ("propose_edit", False, True), (", ", False, False), ("run_terminal_command", False, True),
    (" (approval-gated, orange in the diagram), plus ", False, False), ("go_to_definition", False, True),
    (" which wraps VS Code's own ", False, False), ("executeDefinitionProvider", False, True),
    (" \u2014 editor-native and far cheaper than grep for \u201cwhere is X actually defined,\u201d a genuine differentiator versus grep-only forks.", False, False),
])
body(doc, [
    ("TrueForge's own native tool-approval mechanism drives the diff-review flow", True, False),
    (" \u2014 we did not build a separate approval system. ", False, False), ("propose_edit", False, True),
    (" returns a diff and is marked needs-approval; TrueForge's ", False, False), ("tool.approval_required", False, True),
    (" event pauses the turn until the extension's approval handler resolves it, and only then does ", False, False),
    ("vscode.workspace.applyEdit", False, True), (" (per accepted hunk, undo-stack integrated) touch disk. This is also what makes cancellation safe: if a turn is cancelled before approval, nothing was ever written.", False, False),
])
body(doc, [
    ("Connector registration is fully automatic: on activation the extension starts the MCP server with a fresh bearer token and self-registers it with TrueForge; the agent definition (", False, False),
    ("coding-agent.json", False, True), (") attaches it by name.", False, False),
])

# 4. Context
h2(doc, "4. How context is selected")
body(doc, [
    ("Two layers, by design. ", False, False), ("Layer 1", True, False), (" (before the turn): the editor assembles a small, budgeted opening bid under ", False, False),
    ("trueforgeAgent.contextTokenBudget", False, True), (" (default ", False, False), ("6,000 tokens", True, False),
    (") \u2014 explicit ", False, False), ("@file", False, True), ("/", False, False), ("@symbol", False, True),
    (" mentions first, then automatic retrieval for agent mode: ripgrep keyword counts, IDF \u00d7 BM25-style saturated scoring with file-length normalisation, one reserved slot each for the best source/test/doc file (tests and docs sharing a name stem with the top source file are boosted), and only \u00b12-line windows around matches \u2014 never whole files. ", False, False),
    ("Layer 2", True, False), (": the agent's own tools carry hard per-call budgets \u2014 ", False, False),
    ("repo_map", False, True), (" capped at ", False, False), ("4,000 tokens", True, False),
    (" (directory tree + top-level symbols only, via VS Code's own ", False, False), ("DocumentSymbolProvider", False, True),
    (", cached and invalidated on save), ", False, False), ("read_file", False, True), (" capped at ", False, False),
    ("200 lines per call", True, False), (" (no range on a large file returns an outline, never the full text), ", False, False),
    ("search_code", False, True), (" capped at 20 results / ~300 chars per snippet.", False, False),
])
doc.add_picture(f"{BASE}/docs/diagrams/png/context_assembly.png", width=Inches(6.2))
doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
body(doc, [
    ("The panel renders a visible ", False, False), ("\u201cContext selected\u201d", True, False),
    (" card listing every file chosen, why, and its token cost \u2014 on ", False, False), ("pallets/flask", False, True),
    (" 3.1.3 with the real Task B wording it selects ", False, False), ("src/flask/cli.py", False, True), (", ", False, False),
    ("tests/test_cli.py", False, True), (" and ", False, False), ("docs/cli.rst", False, True),
    (" in about 4.4k tokens, well under budget. Total tool-context per turn stays under ~10k tokens even on this 17k-line repo. This design is also where B4's \u201cmeaningful subagent use\u201d comes from: a scout subagent calls only the read-only tools and hands a condensed summary to a separate editing agent \u2014 one coherent design covering both B1 and B4, not two bolted-on features.", False, False),
])

# 5. Model setup
h2(doc, "5. Model setup")
table = doc.add_table(rows=3, cols=4)
set_no_border_table(table)
hdr = ["Role", "Model", "Where it runs", "Approx. cost"]
for i, text in enumerate(hdr):
    cell = table.rows[0].cells[i]
    shade_cell(cell, "EEEEEE")
    run = cell.paragraphs[0].add_run(text)
    run.bold = True
    run.font.size = Pt(10)
rows_data = [
    ("Primary", "openai/gpt-5-4-mini", "OpenAI API, via TrueForge", "$0 \u2014 free tier / own trial credits"),
    ("Fallback", "ollama/qwen25-7b", "Local Ollama", "$0 \u2014 runs locally"),
]
for ridx, row in enumerate(rows_data, start=1):
    for cidx, val in enumerate(row):
        cell = table.rows[ridx].cells[cidx]
        run = cell.paragraphs[0].add_run(val)
        run.font.size = Pt(10)
        if cidx == 1:
            run.font.name = 'Menlo'
body(doc, [
    ("Switching models is a VS Code setting, no code change: ", False, False), ("trueforgeAgent.primaryModel", False, True),
    (" / ", False, False), ("trueforgeAgent.fallbackModel", False, True), (", read at runtime from ", False, False),
    ("coding-agent.json", False, True), (" so any model configured in TrueForge works.", False, False),
])

# 6. Tools used (renumbered from 7; scorecard section removed per request)
h2(doc, "6. Tools used")
body(doc, [
    ("An AI coding assistant was used for implementation, debugging live integration issues against a running TrueForge instance, and this write-up/diagrams. All architecture decisions, the live debugging (SSL/binding issues, MCP spec compliance, session-persistence bug, duplicate-listener bug), and the final working build were driven and verified by the team against a real running TrueForge server \u2014 not generated and left unverified.", False, False),
])

# 7. Limitations (renumbered from 8)
h2(doc, "7. Known limitations and what we'd do with another month")
limitations = [
    "No OCR or non-text context handling (images, scanned docs) \u2014 everything is text/code only.",
    "go_to_definition is only as accurate as the language server's own resolution on Flask's codebase; it inherits any gaps in VS Code's Python/Jedi support rather than fixing them.",
    "The scout/editor subagent split is a fixed 2-stage pipeline, not a decision the agent makes dynamically itself \u2014 a month more would make this an agent-driven choice via TrueForge's dynamic subagent support, rather than hardcoded in our extension.",
    "No automated test suite for the MCP server tools themselves (repo_map, search_code, etc.) \u2014 they were verified through live, repeated manual runs against the real Flask fixture, not unit tests. This is the most honest gap: correctness rests on rehearsal, not CI.",
    "Context retrieval's keyword scoring (IDF \u00d7 BM25-style) is tuned by inspection on one repo (Flask); it has not been validated against a second, structurally different codebase, so its token-budget behaviour on e.g. a monorepo or a non-Python project is unverified.",
]
for item in limitations:
    p = doc.add_paragraph(style='List Bullet')
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run(item)
    r.font.size = Pt(10.5)

doc.save(f"{BASE}/docs/WRITEUP.docx")
print("saved", f"{BASE}/docs/WRITEUP.docx")
