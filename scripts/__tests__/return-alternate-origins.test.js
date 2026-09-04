const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { resolveInboundFocusRoutes } = require("../return-focus-routes");
const { buildReturnTasks, loadConfig } = require("../load-monitor-config");

describe("return alternate origins", () => {
  const trip = {
    returnDateCompare: ["2026-10-07", "2026-10-08"],
    returnAlternateOrigins: ["乌鲁木齐", "博乐", "石河子"],
    focusRoutes: {
      inbound: [{ origin: "伊宁", dest: "广州", dates: ["2026-10-07", "2026-10-08"] }],
    },
  };

  it("expands focus inbound with alternate airports", () => {
    const routes = resolveInboundFocusRoutes(trip, { origins: ["广州"] });
    assert.equal(routes.length, 4);
    assert.deepEqual(new Set(routes.map((r) => r.origin)), new Set(["伊宁", "乌鲁木齐", "博乐", "石河子"]));
    for (const r of routes) {
      assert.equal(r.dest, "广州");
      assert.deepEqual(r.dates, ["2026-10-07", "2026-10-08"]);
    }
  });

  it("buildReturnTasks queries all expanded routes in focus mode", () => {
    const cfg = loadConfig();
    if (!cfg.focusMode) return;
    const tasks = buildReturnTasks(cfg);
    const origins = new Set(tasks.map((t) => t.origin));
    assert.ok(origins.has("伊宁"));
    assert.ok(origins.has("乌鲁木齐"));
    assert.ok(origins.has("博乐"));
    assert.ok(origins.has("石河子"));
    assert.equal(tasks.length, 8);
  });
});
