const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildFocusTasks, loadTripProfile } = require("../load-trip-profile");
const path = require("path");

describe("load-trip-profile", () => {
  it("buildFocusTasks expands inbound routes", () => {
    const tasks = buildFocusTasks(
      {
        inbound: [{ origin: "伊宁", dest: "广州", dates: ["2026-10-07", "2026-10-08"] }],
      },
      "inbound"
    );
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].origin, "伊宁");
    assert.equal(tasks[0].dest, "广州");
  });

  it("loads party size from trip profile file", () => {
    const trip = loadTripProfile({
      tripProfilePath: "config/trip-profile.json",
      focusMode: true,
    });
    assert.equal(trip.partySize, 5);
    assert.equal(trip.scoringProfile, "family_elder");
    assert.ok(trip.focusRoutes.inbound.length > 0);
  });
});
