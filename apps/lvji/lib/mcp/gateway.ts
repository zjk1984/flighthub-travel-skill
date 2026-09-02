import type { McpServerConfig, McpTool } from "./types";
import { isSkillProvider } from "./registry";
import { callHttpTool, discoverHttpTools } from "./http-gateway";
import { listTools, callSkillTool } from "@/lib/skill/runner";

export async function discoverTools(config: McpServerConfig): Promise<McpTool[]> {
  if (isSkillProvider(config.id)) return listTools();
  if (!config.endpoint) return [];
  return discoverHttpTools(config);
}

export async function callTool(
  config: McpServerConfig,
  name: string,
  args: Record<string, unknown>,
) {
  if (isSkillProvider(config.id)) return callSkillTool(config, name, args);
  return callHttpTool(config, name, args);
}
