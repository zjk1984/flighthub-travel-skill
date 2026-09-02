import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FLYAI_TOOLS } from "../lib/skill/catalog.ts";
import { isSkillProvider, providerDefaults } from "../lib/mcp/registry.ts";

test("FlyAI skill only exposes flight and hotel tools", () => {
  const names = FLYAI_TOOLS.map((tool) => tool.name);
  assert.deepEqual(names.sort(), ["search-flight", "search-hotel"]);
});

test("provider defaults include flyai skill and map/web MCP services", () => {
  const defaults = providerDefaults();
  assert.ok(defaults.flyai);
  assert.ok(defaults.amap);
  assert.ok(defaults.tavily);
  assert.ok(defaults.searxng);
  assert.equal(isSkillProvider("flyai"), true);
  assert.equal(isSkillProvider("amap"), false);
});

test("hybrid gateway routes skill and HTTP MCP separately", () => {
  const gateway = readFileSync(
    new URL("../lib/mcp/gateway.ts", import.meta.url),
    "utf8",
  );
  assert.match(gateway, /isSkillProvider/);
  assert.match(gateway, /discoverHttpTools/);
  assert.match(gateway, /callSkillTool/);
});

test("HTTP MCP gateway blocks redirects and requires HTTPS", () => {
  const source = readFileSync(
    new URL("../lib/mcp/http-gateway.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /redirect: "manual"/);
  assert.match(source, /MCP_REDIRECT_BLOCKED/);
});

test("planner discovery accepts skill providers without HTTP endpoint", () => {
  const source = readFileSync(
    new URL("../lib/ai/planner.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /isSkillProvider\(c\.id\) \|\| c\.endpoint/);
});
