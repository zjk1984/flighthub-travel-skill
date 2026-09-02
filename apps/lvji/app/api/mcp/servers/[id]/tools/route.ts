import { configs } from "@/lib/mcp/store";
import { discoverTools } from "@/lib/mcp/gateway";
import { isSkillProvider } from "@/lib/mcp/registry";
import type { McpProviderId } from "@/lib/mcp/types";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const config = (await configs(request))[id as McpProviderId];
  if (!config) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!isSkillProvider(id) && !config.endpoint) {
    return Response.json({ error: "MCP_NOT_CONFIGURED" }, { status: 503 });
  }
  try {
    return Response.json({
      tools: await discoverTools(config),
      mode: isSkillProvider(id) ? "cli" : "live",
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "SERVICE_DISCOVERY_FAILED",
      },
      { status: 502 },
    );
  }
}
