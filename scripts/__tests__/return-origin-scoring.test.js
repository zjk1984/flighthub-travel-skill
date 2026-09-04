const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  returnOriginScore,
  depCityPref,
  shouldUseReturnOriginScoring,
  getOutboundAnchor,
} = require("../return-origin-scoring");

describe("return-origin-scoring", () => {
  const trip = {
    bookedOutbound: { route: "广州→伊宁", date: "2026-10-01" },
    workflow: { confirmed: { outbound: true } },
  };
  const scoring = {
    originScores: { 深圳: 100, 广州: 80 },
    returnOriginScoresByAnchor: {
      伊宁: { 伊宁: 100, 乌鲁木齐: 82, 阿勒泰: 58 },
    },
  };

  it("uses booked outbound dest as anchor", () => {
    assert.equal(getOutboundAnchor(trip), "伊宁");
  });

  it("scores 伊宁 return origin at 100", () => {
    assert.equal(returnOriginScore("伊宁", trip, scoring), 100);
  });

  it("penalizes distant return origins", () => {
    assert.equal(returnOriginScore("乌鲁木齐", trip, scoring), 82);
    assert.ok(returnOriginScore("阿勒泰", trip, scoring) < returnOriginScore("伊宁", trip, scoring));
  });

  it("applies return origin scoring for inbound when outbound booked", () => {
    assert.equal(shouldUseReturnOriginScoring(trip, "inbound"), true);
    const meta = depCityPref(
      { xjAirport: "乌鲁木齐", origin: "乌鲁木齐", dest: "广州", route: "乌鲁木齐→广州" },
      "inbound",
      trip,
      scoring
    );
    assert.equal(meta.mode, "return_origin");
    assert.equal(meta.pts, 82);
  });

  it("keeps guangdong scoring for outbound", () => {
    const meta = depCityPref(
      { origin: "广州", dest: "伊宁", xjAirport: "伊宁", route: "广州→伊宁" },
      "outbound",
      trip,
      scoring
    );
    assert.equal(meta.mode, "outbound_origin");
    assert.equal(meta.pts, 80);
  });
});
