const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { applyActiveVariant } = require("../load-trip-profile");

describe("applyActiveVariant", () => {
  it("uses root itinerary for duku", () => {
    const raw = {
      label: "主方案",
      activeVariant: "duku",
      itinerary: { overview: "独库" },
      hotels: [{ segment: "D5" }],
      itineraryVariants: {
        planb: { label: "Plan B", itinerary: { overview: "Plan B" }, hotels: [{ segment: "D5 伊宁" }] },
      },
    };
    const resolved = applyActiveVariant(raw);
    assert.equal(resolved.itinerary.overview, "独库");
    assert.equal(resolved.hotels[0].segment, "D5");
  });

  it("switches to planb variant", () => {
    const raw = {
      label: "主方案",
      activeVariant: "planb",
      itinerary: { overview: "独库" },
      hotels: [{ segment: "D5 新源" }],
      itineraryVariants: {
        planb: {
          label: "Plan B",
          itinerary: { overview: "Plan B 路线" },
          hotels: [{ segment: "D5 伊宁" }],
        },
      },
    };
    const resolved = applyActiveVariant(raw);
    assert.equal(resolved.label, "Plan B");
    assert.equal(resolved.itinerary.overview, "Plan B 路线");
    assert.equal(resolved.hotels[0].segment, "D5 伊宁");
  });
});
