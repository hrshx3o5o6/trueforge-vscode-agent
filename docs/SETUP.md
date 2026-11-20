# Setup

The authoritative clean-clone steps are in the [README](../README.md#setup-from-a-clean-clone).
This page covers verification and troubleshooting.

## Verify each piece
| Check | Command / where | Expected |
|---|---|---|
| TrueForge up | `curl -s -o /dev/null -w '%{http_code}' localhost:8790/api/v1/docs` | `200` |
| Models configured | `curl -s localhost:8790/api/v1/models` | your model names |
| Connector registered | `curl -s localhost:8790/api/v1/mcp-servers` | an entry named `trueforge-vscode-agent` |
| Extension active | status bar after F5 | "TrueForge Agent: tools connected" |
| Tools reachable | `curl -s localhost:8790/api/v1/mcp-servers/trueforge-vscode-agent/tools` | six tools |

## Troubleshooting
- **"Outbound URL blocked for host 127.0.0.1"**: TrueForge was started
  without the allow-list. Restart it with
  `OUTBOUND_URL_ALLOWED_HOSTS='["localhost","127.0.0.1"]' npx @truefoundry/trueforge@latest`.
- **"TrueForge is not reachable"**: start TrueForge first, then run
  "Developer: Reload Window" in the Extension Development Host (the
  connector is registered on activation).
- **Unknown model / HTTP 422 on session create**: `trueforgeAgent.primaryModel`
  must match a name from `GET /api/v1/models` exactly.
- **Several VS Code windows**: each window re-registers the same connector
  with its own port and token, and the last one to activate wins. Run the
  agent from one window at a time.
- **`search_code` errors**: the extension uses VS Code's bundled ripgrep
  (`@vscode/ripgrep-universal`), falling back to `rg` on PATH.

## Task C (resilience) rehearsal
1. In TrueForge, add a model whose endpoint is unreachable or whose key is
   invalid, and set it as `trueforgeAgent.primaryModel`. Keep a working
   `fallbackModel`.
2. Repeat Task A. The panel shows the failed attempt, the backoff retries,
   then "Switching to fallback model … automatically", and the edit
   completes on the fallback.
3. With `fallbackModel` empty, you get a clear "All configured models
   failed … No files were changed." `git status` stays clean either way.
