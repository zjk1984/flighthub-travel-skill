const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  recordSnapshots,
  formatDelta,
  lowestPriceFromFlights,
} = require("../price-history");

describe("price-history", () => {
  it("records lowest price and computes delta", () => {
    const tmp = path.join(os.tmpdir(), `price-history-${Date.now()}.jsonl`);
    recordSnapshots([
      {
        route: "伊宁→广州",
        date: "2026-10-08",
        flights: [{ price: "¥1800" }, { price: "¥1658" }],
      },
    ], tmp);

    recordSnapshots([
      {
        route: "伊宁→广州",
        date: "2026-10-08",
        flights: [{ price: "¥1600" }],
      },
    ], tmp);

    const raw = fs.readFileSync(tmp, "utf8").trim().split("\n").map(JSON.parse);
    const row = raw.find((r) => r.route === "伊宁→广州");
    assert.equal(row.lowestPrice, 1600);
    assert.equal(row.prevLowest, 1658);
    const delta = formatDelta({ ...row, prevRecordedOn: "2026-09-02" });
    assert.match(delta, /1658.*1600|-58/);
    fs.unlinkSync(tmp);
  });

  it("lowestPriceFromFlights ignores invalid", () => {
    assert.equal(lowestPriceFromFlights([{ price: "¥888" }]), 888);
    assert.equal(lowestPriceFromFlights([]), null);
  });
});
