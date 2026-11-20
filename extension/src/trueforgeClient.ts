/**
 * Thin wrapper around @truefoundry/trueforge-sdk. The agent definition
 * itself lives in agents/coding-agent.json (committed, model-agnostic);
 * the model name is injected from VS Code settings at session creation.
 *
 * The MCP server MUST be attached to the agent spec by name
 * (spec.mcpServers) — registering a connector in TrueForge does not by
 * itself give a session any tools. Approval for the write tools is
 * TrueForge-native (requireApprovalForTools), and the extension answers
 * the resulting tool.approval_required events from its diff review UI.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { TrueForge, type TrueForgeApi } from "@truefoundry/trueforge-sdk";

export interface AgentModelConfig {
  name: string; // e.g. "openai/gpt-5-4-mini" — must match a model configured in TrueForge
}

export interface TrueForgeConfig {
  baseUrl: string;
  token?: string;
  primaryModel: AgentModelConfig;
  fallbackModel?: AgentModelConfig;
  mcpServerUrl: string;
  contextTokenBudget: number;
  maxRetries: number;
  stallTimeoutSeconds: number;
}

export interface AgentDefinition {
  name: string;
  instructions: string;
  mcpServer: {
    name: string;
    description: string;
    preload?: boolean;
    requireApprovalForTools?: string[];
  };
  config?: TrueForgeApi.RuntimeConfig;
}

let definition: AgentDefinition | undefined;

export function loadAgentDefinition(extensionPath: string): AgentDefinition {
  const file = path.join(extensionPath, "agents", "coding-agent.json");
  definition = JSON.parse(fs.readFileSync(file, "utf8")) as AgentDefinition;
  return definition;
}

export function agentDefinition(): AgentDefinition {
  if (!definition) {throw new Error("Agent definition not loaded (agents/coding-agent.json).");}
  return definition;
}

/** Names of the tools that pause for TrueForge-native human approval. */
export function approvalGatedTools(): Set<string> {
  return new Set(agentDefinition().mcpServer.requireApprovalForTools ?? []);
}

export function createClient(config: TrueForgeConfig): TrueForge {
  return new TrueForge({
    baseUrl: config.baseUrl,
    token: config.token,
    timeoutInSeconds: 600,
  });
}

export function buildAgentSpec(model: AgentModelConfig): { spec: TrueForgeApi.AgentSpec } {
  const def = agentDefinition();
  return {
    spec: {
      model: { name: model.name },
      instructions: def.instructions,
      mcpServers: [
        {
          name: def.mcpServer.name,
          enableTools: ["@all"],
          // Load all six schemas up front. TrueForge's deferred discovery
          // (preload:false) failed in local mode during testing — the model's
          // list_tools call hit "MCP server 'deferred-tools' not found" — and
          // six small schemas are cheap.
          preload: def.mcpServer.preload ?? true,
          requireApprovalForTools: def.mcpServer.requireApprovalForTools,
        },
      ],
      config: def.config,
    },
  };
}
