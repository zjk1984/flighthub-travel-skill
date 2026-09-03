const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  getProfile,
  timeSlotPoints,
  arrTimeSlotPoints,
  pickScenario,
  isSameDayArrival,
} = require("../scoring-profiles");

describe("scoring-profiles", () => {
  it("family_elder prefers morning departure", () => {
    const p = getProfile("family_elder");
    assert.ok(timeSlotPoints("2026-10-08 09:00:00", p) >= timeSlotPoints("2026-10-08 05:30:00", p));
  });

  it("pickScenario elder favors reasonable arrival", () => {
    const p = getProfile("family_elder");
    const flights = [
      {
        flightNo: "A",
        depDateTime: "2026-10-08 23:00:00",
        arrDateTime: "2026-10-09 08:00:00",
        priceNum: 1500,
        priceVerified: true,
        transfers: 1,
      },
      {
        flightNo: "B",
        depDateTime: "2026-10-08 20:30:00",
        arrDateTime: "2026-10-09 09:40:00",
        priceNum: 1760,
        priceVerified: true,
        transfers: 1,
      },
    ];
    const elder = pickScenario(flights, "elder", p);
    assert.equal(elder.flightNo, "B");
  });

  it("isSameDayArrival detects cross-day", () => {
    assert.equal(
      isSameDayArrival({
        depDateTime: "2026-10-08 16:00:00",
        arrDateTime: "2026-10-09 01:00:00",
      }),
      false
    );
  });
});
