const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildOutboundTasks, buildReturnTasks, loadConfig } = require("../load-monitor-config");

describe("load-monitor-config focus mode", () => {
  it("focus mode uses trip profile routes only", () => {
    const cfg = loadConfig();
    if (!cfg.focusMode) {
      // skip when preset not applied in CI-like env
      return;
    }
    const out = buildOutboundTasks(cfg);
    const ret = buildReturnTasks(cfg);
    assert.ok(out.every((t) => t.origin === "广州" && t.dest === "伊宁"));
    assert.ok(ret.length >= 4);
    const origins = new Set(ret.map((t) => t.origin));
    assert.ok(origins.has("伊宁"));
    if (cfg.trip?.returnAlternateOrigins?.length) {
      for (const alt of cfg.trip.returnAlternateOrigins) {
        assert.ok(origins.has(alt), `missing alternate ${alt}`);
      }
    } else {
      assert.ok(ret.every((t) => t.origin === "伊宁" && t.dest === "广州"));
    }
  });
});
