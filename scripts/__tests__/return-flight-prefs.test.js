const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseTimeToMinutes,
  isFeasibleReturnFlight,
  splitFeasible,
  countMainApiFlights,
  renderInventoryAlert,
  getReturnPreferences,
} = require("../return-flight-prefs");

describe("return-flight-prefs", () => {
  it("parseTimeToMinutes handles HH:MM", () => {
    assert.equal(parseTimeToMinutes("12:00"), 720);
    assert.equal(parseTimeToMinutes("09:30"), 570);
  });

  it("isFeasibleReturnFlight rejects early departure", () => {
    const trip = { returnPreferences: { minDepartureTime: "12:00" } };
    const early = { depDateTime: "2026-10-08 09:00:00" };
    const ok = { depDateTime: "2026-10-08 17:00:00" };
    assert.equal(isFeasibleReturnFlight(early, getReturnPreferences(trip)), false);
    assert.equal(isFeasibleReturnFlight(ok, getReturnPreferences(trip)), true);
  });

  it("splitFeasible partitions flights", () => {
    const trip = { returnPreferences: { minDepartureTime: "12:00" } };
    const flights = [
      { depDateTime: "2026-10-08 09:00:00", priceNum: 1000 },
      { depDateTime: "2026-10-08 15:00:00", priceNum: 1200 },
    ];
    const { feasible, other } = splitFeasible(flights, trip);
    assert.equal(feasible.length, 1);
    assert.equal(other.length, 1);
  });

  it("countMainApiFlights excludes custom transfer", () => {
    const entry = {
      flights: [
        { flightNo: "CZ1234", customTransfer: false },
        { flightNo: "X/Y", customTransfer: true },
      ],
    };
    assert.equal(countMainApiFlights(entry), 1);
  });

  it("renderInventoryAlert flags zero main results", () => {
    const results = [
      {
        route: "伊宁→广州",
        date: "2026-10-08",
        flights: [{ customTransfer: true, flightNo: "A/B" }],
      },
    ];
    const trip = {
      focusRoutes: { inbound: [{ origin: "伊宁", dest: "广州", dates: ["2026-10-08"] }] },
    };
    const cfg = { returnDates: ["2026-10-08"] };
    const md = renderInventoryAlert(results, trip, cfg);
    assert.match(md, /库存告警/);
    assert.match(md, /0 条/);
  });
});
