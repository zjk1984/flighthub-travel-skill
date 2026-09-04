const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  splitFeasible,
  splitByItinerary,
  inboundRankingPool,
  shouldFilterTop3ByItinerary,
  renderItineraryConflictAdvisory,
  minDepartureForDate,
} = require("../return-flight-prefs");

describe("return-flight-prefs priority", () => {
  const trip = {
    returnPreferences: { filterTop3ByItinerary: false },
    itineraryConstraints: {
      byDate: {
        "2026-10-08": { minDepartureTime: "12:00", activity: "将军府" },
      },
    },
  };

  const flights = [
    { date: "2026-10-08", depDateTime: "2026-10-08 09:00:00", priceNum: 1200, priceVerified: true },
    { date: "2026-10-08", depDateTime: "2026-10-08 15:50:00", priceNum: 1460, priceVerified: true },
  ];

  it("phase2 does not filter TOP3 by itinerary", () => {
    assert.equal(shouldFilterTop3ByItinerary(trip), false);
    const { feasible, other } = splitFeasible(flights, trip);
    assert.equal(feasible.length, 2);
    assert.equal(other.length, 0);
    assert.equal(inboundRankingPool(flights, trip).length, 2);
  });

  it("itinerary conflict detected for plan advisory only", () => {
    assert.equal(minDepartureForDate(trip, "2026-10-08"), "12:00");
    const { conflict } = splitByItinerary(flights, trip);
    assert.equal(conflict.length, 1);
    assert.match(renderItineraryConflictAdvisory(flights, trip, 5, "plan"), /行程衔接提示/);
    assert.equal(renderItineraryConflictAdvisory(flights, trip, 5, "ranked"), "");
  });

  it("opt-in filterTop3ByItinerary still works", () => {
    const strict = { ...trip, returnPreferences: { filterTop3ByItinerary: true } };
    const { feasible, other } = splitFeasible(flights, strict);
    assert.equal(feasible.length, 1);
    assert.equal(other.length, 1);
  });
});
