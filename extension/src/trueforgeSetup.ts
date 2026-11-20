/**
 * Registers (or re-points) this extension's MCP tool server as a
 * TrueForge connector, so a clean setup needs no manual
 * "Settings -> Connectors -> Add MCP Server" step.
 *
 * Every activation generates a fresh bearer token: the MCP server runs
 * on localhost and can propose edits / run commands, so it only accepts
 * requests carrying the token we just handed to TrueForge.
 *
 * TrueForge's SSRF guard refuses localhost connector URLs unless the
 * server was started with OUTBOUND_URL_ALLOWED_HOSTS — we detect that
 * specific refusal and tell the user the exact command to fix it.
 */
export class ConnectorSetupError extends Error {}

export const TRUEFORGE_START_COMMAND =
  `OUTBOUND_URL_ALLOWED_HOSTS='["localhost","127.0.0.1"]' npx @truefoundry/trueforge@latest`;

export interface ConnectorOptions {
  baseUrl: string;
  token?: string;
  name: string;
  description: string;
  mcpUrl: string;
  mcpAuthToken: string;
}

async function call(
  opts: ConnectorOptions,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) {headers.authorization = `Bearer ${opts.token}`;}
  let res: Response;
  try {
    res = await fetch(`${opts.baseUrl.replace(/\/$/, "")}/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new ConnectorSetupError(
      `TrueForge is not reachable at ${opts.baseUrl} (${(err as Error).message}). Start it with:\n${TRUEFORGE_START_COMMAND}`,
    );
  }
  return { status: res.status, text: await res.text() };
}

export async function ensureConnector(opts: ConnectorOptions): Promise<void> {
  const manifest = {
    type: "remote",
    name: opts.name,
    url: opts.mcpUrl,
    description: opts.description,
    auth: { type: "header", headers: { Authorization: `Bearer ${opts.mcpAuthToken}` } },
  };

  const existing = await call(opts, "GET", `/settings/mcp-servers/${opts.name}`);
  const result =
    existing.status === 404
      ? await call(opts, "POST", "/settings/mcp-servers", { manifest })
      : await call(opts, "PUT", "/settings/mcp-servers", { manifest });

  if (result.status >= 200 && result.status < 300) {return;}
  if (result.text.includes("Outbound URL blocked")) {
    throw new ConnectorSetupError(
      `TrueForge refused the localhost MCP connector (its SSRF guard blocks 127.0.0.1 by default). ` +
        `Restart TrueForge with:\n${TRUEFORGE_START_COMMAND}`,
    );
  }
  throw new ConnectorSetupError(`Registering the MCP connector failed (HTTP ${result.status}): ${result.text.slice(0, 300)}`);
}
