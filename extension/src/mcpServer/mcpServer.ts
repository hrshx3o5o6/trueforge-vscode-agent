/**
 * The MCP server itself: registers our 6 tools with the official SDK and
 * serves them over streamable HTTP so TrueForge can connect to it as a
 * localhost connector (Settings -> Connectors -> Add MCP Server, no auth).
 *
 * Runs INSIDE the extension host (see docs/DECISIONS.md) — started from
 * extension.ts's activate(), stopped on deactivate().
 *
 * propose_edit / run_terminal_command gate on human approval via
 * approvalRegistry.ts (Phase 3) — see the architecture note at the top of
 * tools/proposeEdit.ts for why this is our own in-process gate rather
 * than a TrueForge-native approval event.
 */
import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type * as http from "node:http";

import { buildRepoMap, REPO_MAP_TOKEN_BUDGET } from "./tools/repoMap.js";
import { searchCode, SEARCH_MAX_RESULTS } from "./tools/searchCode.js";
import { readFile } from "./tools/readFile.js";
import { proposeEdit, reconstructContentFromAcceptedHunks } from "./tools/proposeEdit.js";
import { applyAndRecord } from "./editJournal.js";
import { runTerminalCommand } from "./tools/runTerminalCommand.js";
import { goToDefinition } from "./tools/goToDefinition.js";
import {
  requestEditApproval,
  requestCommandApproval,
  takeEditDecision,
  takeCommandApproval,
  writesAreBlocked,
  onEditProposed,
  onCommandProposed,
  type PendingEditRequest,
  type PendingCommandRequest,
} from "./approvalRegistry.js";

export interface McpServerHandle {
  close: () => Promise<void>;
  port: number;
  /** Fired whenever any tool is invoked — a lightweight activity log for the webview. */
  onToolCall: (listener: (name: string, args: unknown) => void) => void;
  /** Fired when propose_edit is waiting on human review (Phase 3). */
  onEditProposed: (listener: (req: PendingEditRequest) => void) => void;
  /** Fired when run_terminal_command is waiting on human approval. */
  onCommandProposed: (listener: (req: PendingCommandRequest) => void) => void;
}

function createMcpServer(notify: (name: string, args: unknown) => void): McpServer {
  const server = new McpServer({ name: "trueforge-vscode-agent-tools", version: "0.1.0" });

  server.registerTool(
    "repo_map",
    {
      annotations: { readOnlyHint: true },
      description:
        `Directory tree + top-level symbols for the open workspace, capped at ~${REPO_MAP_TOKEN_BUDGET} tokens. ` +
        `Call this first in any multi-file task — it's cheap and cached. Do not call it more than once per turn.`,
      inputSchema: {},
    },
    async () => {
      notify("repo_map", {});
      const { text, truncated, fileCount } = await buildRepoMap();
      const suffix = truncated ? "\n\n(truncated to fit the token budget)" : "";
      return { content: [{ type: "text", text: text + suffix + `\n\n(${fileCount} files scanned)` }] };
    },
  );

  server.registerTool(
    "search_code",
    {
      annotations: { readOnlyHint: true },
      description:
        `Ripgrep-backed search across the workspace. Returns up to ${SEARCH_MAX_RESULTS} ranked snippets ` +
        `(file, line, ~300-char context). If more matches exist, narrow your query instead of assuming you saw everything.`,
      inputSchema: {
        query: z.string().describe("Regex or plain text to search for"),
        path_glob: z.string().optional().describe("Optional glob to restrict the search, e.g. 'src/**/*.py'"),
      },
    },
    async ({ query, path_glob }) => {
      notify("search_code", { query, path_glob });
      const result = await searchCode(query, path_glob);
      const lines = result.hits.map((h) => `${h.file}:${h.line}: ${h.snippet}`);
      const note = result.truncated
        ? `\n\n(showing ${result.hits.length} of ${result.totalMatches} matches — narrow your query for the rest)`
        : "";
      return { content: [{ type: "text", text: (lines.join("\n") || "(no matches)") + note }] };
    },
  );

  server.registerTool(
    "read_file",
    {
      annotations: { readOnlyHint: true },
      description:
        "Read a file from the workspace. Without a line range on a file longer than 40 lines, returns an " +
        "outline (symbol names + line numbers) instead of the full text — call again with a range to see a body.",
      inputSchema: {
        path: z.string().describe("Workspace-relative file path"),
        start_line: z.number().int().min(0).optional().describe("0-indexed start line"),
        end_line: z.number().int().min(0).optional().describe("0-indexed end line (exclusive)"),
      },
    },
    async ({ path, start_line, end_line }) => {
      notify("read_file", { path, start_line, end_line });
      const range = start_line !== undefined && end_line !== undefined ? { start: start_line, end: end_line } : undefined;
      const result = await readFile(path, range);
      return { content: [{ type: "text", text: `[mode: ${result.mode}, ${result.totalLines} total lines]\n${result.content}` }] };
    },
  );

  server.registerTool(
    "propose_edit",
    {
      annotations: { readOnlyHint: false, destructiveHint: false },
      description:
        "Propose writing new content to a file. NEVER writes directly — pauses here for human review in the " +
        "editor (per-hunk accept/reject) before returning. Call once per file for a multi-file change.",
      inputSchema: {
        path: z.string().describe("Workspace-relative file path (created if it doesn't exist)"),
        new_content: z.string().describe("The full proposed new content of the file"),
      },
    },
    async ({ path, new_content }) => {
      notify("propose_edit", { path });
      if (writesAreBlocked()) {
        return { content: [{ type: "text", text: `The run was cancelled; ${path} was not changed. Stop now.` }] };
      }
      const result = await proposeEdit(path, new_content);

      if (result.hunks.length === 0) {
        return { content: [{ type: "text", text: `No changes: ${result.path} already matches the proposed content.` }] };
      }

      // Normal path: TrueForge paused for approval before calling us and
      // the user already picked hunks in the review card. Fallback path:
      // no recorded decision, so block here on the in-process gate.
      let accepted = takeEditDecision(result.path, new_content);
      if (!accepted) {
        accepted = (await requestEditApproval(result)).acceptedHunkIndices;
      }
      if (writesAreBlocked()) {
        return { content: [{ type: "text", text: `The run was cancelled; ${result.path} was not changed. Stop now.` }] };
      }
      if (accepted.size === 0) {
        return { content: [{ type: "text", text: `User rejected all ${result.hunks.length} hunk(s) for ${result.path}. No changes were made.` }] };
      }

      const finalContent = reconstructContentFromAcceptedHunks(result.path, result.oldContent, result.hunks, accepted);
      await applyAndRecord(result.path, result.oldContent, result.fileExisted, finalContent);

      const partial = accepted.size < result.hunks.length;
      return {
        content: [
          {
            type: "text",
            text: `Applied ${accepted.size} of ${result.hunks.length} hunk(s) to ${result.path} (saved to disk).${partial ? " Some hunks were rejected by the user — re-read the file if you need its exact current state." : ""}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "run_terminal_command",
    {
      annotations: { readOnlyHint: false, destructiveHint: true },
      description: "Run a shell command in the workspace root. Pauses for human approval before running; 30s timeout.",
      inputSchema: { command: z.string() },
    },
    async ({ command }) => {
      notify("run_terminal_command", { command });
      if (writesAreBlocked()) {
        return { content: [{ type: "text", text: `The run was cancelled; did not run: ${command}` }] };
      }
      const approved = takeCommandApproval(command) || (await requestCommandApproval(command));
      if (!approved) {
        return { content: [{ type: "text", text: `User declined to run: ${command}` }] };
      }
      const result = await runTerminalCommand(command);
      const text = `$ ${command}\n(exit ${result.exitCode}${result.timedOut ? ", TIMED OUT" : ""})\n${result.stdout}${result.stderr ? "\n--- stderr ---\n" + result.stderr : ""}`;
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "go_to_definition",
    {
      annotations: { readOnlyHint: true },
      description:
        "Find a symbol's real definition using the editor's own language intelligence (more precise than search_code for 'where is X defined').",
      inputSchema: { symbol: z.string() },
    },
    async ({ symbol }) => {
      notify("go_to_definition", { symbol });
      const hit = await goToDefinition(symbol);
      if (!hit) {return { content: [{ type: "text", text: `No definition found for "${symbol}".` }] };}
      return { content: [{ type: "text", text: `${hit.file}:${hit.line + 1}: ${hit.preview}` }] };
    },
  );

  return server;
}

export async function startMcpServer(port: number, authToken: string): Promise<McpServerHandle> {
  const listeners: Array<(name: string, args: unknown) => void> = [];
  const notify = (name: string, args: unknown) => listeners.forEach((l) => l(name, args));

  const app = express();
  app.use(express.json({ limit: "20mb" }));
  // Only TrueForge (which we hand this token to on every activation, see
  // trueforgeSetup.ts) may call these tools — the server can propose
  // edits and run commands, so it must not be open to any local process.
  app.use("/mcp", (req, res, next) => {
    if (req.headers.authorization !== `Bearer ${authToken}`) {
      res.status(401).json({ error: "missing or invalid bearer token" });
      return;
    }
    next();
  });

  // One MCP server instance per session id, per the SDK's streamable-HTTP
  // session model; a single-user local extension only ever has one real
  // client (TrueForge) but we still follow the documented session pattern.
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      const newSessionId = randomUUID();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
        onsessioninitialized: (id) => {
          transports.set(id, transport!);
        },
      });
      const mcpServer = createMcpServer(notify);
      await mcpServer.connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
  });

  // The Streamable HTTP transport spec requires GET (server-to-client
  // notification stream) and DELETE (session termination) on the SAME
  // endpoint, not just POST. Missing these isn't a cosmetic gap — a real
  // client's GET probe fell through to Express's generic 404 before this
  // fix (caught during the first live test against TrueForge).
  //
  // Second real-world correction: a client (TrueForge, observed live) may
  // send GET as its very FIRST request, before ever POSTing to create a
  // session — e.g. to probe the endpoint or open a server-push stream
  // speculatively. We don't support session-less server push, and the
  // spec's documented answer for that is 405 Method Not Allowed, not a
  // generic error — clients check for exactly that status to know "fine,
  // POST-only is OK, proceed with request/response." A custom 400 here
  // was being treated as a hard connector failure.
  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(405).set("Allow", "POST").send("Method Not Allowed: this server does not support a session-less GET stream. POST to /mcp to start a session.");
      return;
    }
    await transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      // Nothing to terminate — treat as already-closed, not an error.
      res.status(204).end();
      return;
    }
    await transport.handleRequest(req, res);
    transports.delete(sessionId!);
  });

  // If the preferred port is taken (a second VS Code window, a stale
  // process), fall back to an OS-assigned port instead of hanging
  // activate() forever — the connector is re-registered with whatever
  // port we actually got (see trueforgeSetup.ts).
  const listenOn = (p: number): Promise<http.Server> =>
    new Promise((resolve, reject) => {
      const s = app.listen(p, "127.0.0.1");
      s.once("listening", () => resolve(s));
      s.once("error", reject);
    });
  let server: http.Server;
  try {
    server = await listenOn(port);
  } catch {
    server = await listenOn(0);
  }
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  return {
    port: actualPort,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    onToolCall: (listener) => listeners.push(listener),
    onEditProposed: (listener) => onEditProposed(listener),
    onCommandProposed: (listener) => onCommandProposed(listener),
  };
}
