const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { resolveVariant, buildContext } = require("../format-travel-cards");

describe("format-travel-cards variant fallback", () => {
  it("uses named variant when itineraryVariants still exist", () => {
    const trip = {
      itinerary: { overview: "root" },
      itineraryVariants: {
        planb: { label: "Plan B", itinerary: { overview: "Plan B 路线" } },
      },
    };
    const v = resolveVariant(trip, "planb");
    assert.equal(v.label, "Plan B");
  });

  it("falls back to root for planb/final after variants are flattened", () => {
    const trip = { itinerary: { overview: "定稿" }, itineraryVariants: {} };
    assert.equal(resolveVariant(trip, "planb"), null);
    assert.equal(resolveVariant(trip, "final"), null);
    assert.equal(resolveVariant(trip, "unknown-plan"), null);
  });

  it("throws for unknown names only when other variants still exist", () => {
    const trip = {
      itineraryVariants: { fallback: { label: "封路" } },
    };
    assert.throws(() => resolveVariant(trip, "unknown-plan"), /Unknown itinerary variant/);
    assert.equal(resolveVariant(trip, "planb"), null);
  });

  it("buildContext(--variant planb) renders flattened trip-profile days", () => {
    const ctx = buildContext("planb");
    const days = ctx.itinerary?.days || [];
    assert.ok(days.length >= 8, "expected D1–D8");
    assert.match(ctx.label, /伊犁/);
    assert.ok(ctx.hotelOverrides["2026-10-06"]?.name.includes("喀兰朵"));
    assert.doesNotMatch(JSON.stringify(days), /六星街|那拉提|夏塔/);
  });
});
