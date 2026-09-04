const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { isResultCacheable } = require("../flight-cache");

describe("flight-cache", () => {
  it("does not cache empty flight lists", () => {
    assert.equal(isResultCacheable({ flights: [] }), false);
    assert.equal(isResultCacheable({ flights: [{ price: 100 }] }), true);
    assert.equal(isResultCacheable({ apiError: "empty", flights: [] }), false);
  });
});
