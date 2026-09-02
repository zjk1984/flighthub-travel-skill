import type { McpProviderId, McpServerConfig, McpTool } from "./types";

export const providerDefaults = (): Record<McpProviderId, McpServerConfig> => ({
  flyai: {
    id: "flyai",
    name: "FlyAI 飞猪旅行",
    endpoint: "cli://flyai",
    homepage: "https://github.com/zjk1984/flighthub-travel-skill",
    apiKey: process.env.FLYAI_API_KEY || "",
    authMode: process.env.FLYAI_API_KEY ? "bearer" : "none",
    enabled: true,
    permission: "readonly",
    source: "builtin",
  },
  amap: {
    id: "amap",
    name: "高德地图",
    endpoint: process.env.MCP_AMAP_URL || "https://mcp.amap.com/mcp",
    apiKey: process.env.AMAP_WEB_SERVICE_KEY || "",
    authMode: process.env.AMAP_WEB_SERVICE_KEY ? "bearer" : "none",
    enabled: true,
    permission: "readonly",
    source: "builtin",
  },
  tavily: {
    id: "tavily",
    name: "Tavily 搜索",
    endpoint: process.env.MCP_TAVILY_URL || "https://mcp.tavily.com/mcp/",
    apiKey: process.env.TAVILY_API_KEY || "",
    authMode: process.env.TAVILY_API_KEY ? "bearer" : "none",
    enabled: true,
    permission: "readonly",
    source: "builtin",
  },
  searxng: {
    id: "searxng",
    name: "SearXNG 搜索",
    endpoint: process.env.MCP_SEARXNG_URL || "",
    homepage: "https://github.com/ihor-sokoliuk/mcp-searxng",
    authMode: "none",
    enabled: false,
    permission: "readonly",
    source: "builtin",
  },
});

export const knownToolSchemas: Partial<Record<McpProviderId, McpTool[]>> = {
  searxng: [
    { name: "searxng_web_search", description: "聚合网页搜索" },
    { name: "searxng_search_suggestions", description: "搜索建议" },
    { name: "web_url_read", description: "读取网页正文" },
  ],
  amap: [
    { name: "maps_geo", description: "地理编码" },
    { name: "maps_search_detail", description: "地点搜索" },
    { name: "maps_direction_transit_integrated", description: "公交路线规划" },
    { name: "maps_weather", description: "天气查询" },
  ],
  tavily: [
    { name: "tavily-search", description: "实时网页搜索" },
    { name: "tavily-extract", description: "提取网页正文" },
  ],
};

export function isSkillProvider(id: string) {
  return id === "flyai";
}
