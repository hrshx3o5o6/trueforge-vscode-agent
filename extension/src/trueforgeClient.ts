/**
 * Thin wrapper around @truefoundry/trueforge-sdk, configured from
 * .env / workspace settings. Owns the one agent spec used for both
 * inline-edit (single turn) and agent-mode (multi-turn) sessions, plus
 * a fallback spec for the resilience path (B3 / Task C).
 */
import { TrueForge } from "@truefoundry/trueforge-sdk";

export interface AgentModelConfig {
  name: string; // e.g. "anthropic/claude-sonnet-4-6" — must match a provider configured in TrueForge
}

export interface TrueForgeConfig {
  baseUrl: string;
  token?: string;
  primaryModel: AgentModelConfig;
  fallbackModel?: AgentModelConfig;
  mcpServerUrl: string; // our own localhost MCP server, registered as a connector
}

const AGENT_INSTRUCTIONS = `You are a coding agent working inside the user's editor.
You have tools to explore the repository (repo_map, search_code, read_file,
go_to_definition) and to propose changes (propose_edit, run_terminal_command).
Never assume a file's contents — read or search before editing. For any
multi-file task, call repo_map first, then search_code / read_file to find
the exact files and patterns involved, THEN propose_edit per file. Keep tool
calls purposeful: don't re-call repo_map more than once per session, and
narrow search_code queries instead of reading whole files when you can.

Act, don't ask. propose_edit and run_terminal_command already pause for the
user's explicit approval in the editor before anything happens to their
files or runs on their machine — that IS the permission step. Do not describe
a plan and ask "should I proceed?" in chat first; that is redundant friction
on top of a gate that already exists. When a request is concrete (e.g. "add
X to file Y"), just call the tools immediately. Only ask a clarifying
question in chat when the request is genuinely ambiguous about WHAT to do,
never as a substitute for actually calling propose_edit/run_terminal_command.`;

export function createClient(config: TrueForgeConfig): TrueForge {
  return new TrueForge({
    baseUrl: config.baseUrl,
    token: config.token,
    timeoutInSeconds: 600,
  });
}

export function buildAgentSpec(model: AgentModelConfig) {
  return {
    spec: {
      model: { name: model.name },
      instructions: AGENT_INSTRUCTIONS,
    },
  };
}
