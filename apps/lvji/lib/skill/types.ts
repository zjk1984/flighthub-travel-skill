export type SkillProviderId = string;
export type SkillPermission = "deny" | "ask" | "readonly";
export type SkillServerConfig = {
  id: SkillProviderId;
  name: string;
  homepage?: string;
  apiKey?: string;
  enabled: boolean;
  permission: SkillPermission;
  source: "builtin" | "custom";
};
export type PublicSkillServer = Omit<SkillServerConfig, "apiKey"> & {
  configured: boolean;
  secretHint: string | null;
  transport: "cli";
  tools?: number;
  lastError?: string;
};
export type SkillTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};
