const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  transferScoreBreakdown,
  transferCountPenalty,
  PENALTY_ONE_TRANSFER,
  PENALTY_MULTI_TRANSFER,
  PENALTY_CROSS_DAY,
  PENALTY_CUSTOM_TRANSFER,
} = require("../transfer-scoring");

describe("transfer-scoring", () => {
  it("transferCountPenalty: 0 / 1 / 2+", () => {
    assert.equal(transferCountPenalty(0), 0);
    assert.equal(transferCountPenalty(1), PENALTY_ONE_TRANSFER);
    assert.equal(transferCountPenalty(2), PENALTY_MULTI_TRANSFER);
    assert.equal(transferCountPenalty(3), PENALTY_MULTI_TRANSFER);
  });

  it("direct same-day → 100", () => {
    const b = transferScoreBreakdown({
      transfers: 0,
      depDateTime: "2026-10-08 15:50:00",
      arrDateTime: "2026-10-08 23:50:00",
    });
    assert.equal(b.basePts, 100);
    assert.equal(b.transferPts, 100);
    assert.equal(b.transferCountPenalty, 0);
  });

  it("1 transfer → base 75", () => {
    const b = transferScoreBreakdown({
      transfers: 1,
      depDateTime: "2026-10-08 15:50:00",
      arrDateTime: "2026-10-08 23:50:00",
    });
    assert.equal(b.basePts, 75);
    assert.equal(b.transferPts, 75);
    assert.equal(b.transferCountPenalty, PENALTY_ONE_TRANSFER);
  });

  it("≥2 transfers → base 50", () => {
    const b = transferScoreBreakdown({ transfers: 2 });
    assert.equal(b.basePts, 50);
    assert.equal(b.transferPts, 50);
    assert.equal(b.transferCountPenalty, PENALTY_MULTI_TRANSFER);
  });

  it("cross-day -25 stacks separately on 1 transfer", () => {
    const b = transferScoreBreakdown({
      transfers: 1,
      depDateTime: "2026-10-08 15:50:00",
      arrDateTime: "2026-10-09 09:20:00",
    });
    assert.equal(b.basePts, 75);
    assert.equal(b.crossDayPenalty, PENALTY_CROSS_DAY);
    assert.equal(b.transferPts, 50);
  });

  it("custom + cross-day both -25 on top of transfer count", () => {
    const b = transferScoreBreakdown({
      transfers: 1,
      customTransfer: true,
      depDateTime: "2026-10-08 09:00:00",
      arrDateTime: "2026-10-09 10:25:00",
    });
    assert.equal(b.basePts, 75);
    assert.equal(b.transferPts, 25);
    assert.equal(b.crossDayPenalty, PENALTY_CROSS_DAY);
    assert.equal(b.customPenalty, PENALTY_CUSTOM_TRANSFER);
  });
});
