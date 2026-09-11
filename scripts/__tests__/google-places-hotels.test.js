const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildGoogleQueries,
  mergeHotelSources,
  normalizeHotelName,
  priceLevelToEstimate,
  mapGooglePlace,
} = require("../google-places-hotels");

describe("google-places-hotels", () => {
  it("buildGoogleQueries includes scenic homestay keywords", () => {
    const queries = buildGoogleQueries({
      destName: "尼勒克",
      segment: "D5 百里画廊",
      scenicPoi: "唐布拉",
      scenicHomestay: true,
      keyWords: "唐布拉 百里画廊 民宿",
    });
    assert.ok(queries.some((q) => /唐布拉/.test(q)));
    assert.ok(queries.some((q) => /民宿/.test(q)));
  });

  it("priceLevelToEstimate maps Google price levels", () => {
    assert.equal(priceLevelToEstimate("PRICE_LEVEL_MODERATE"), 350);
    assert.equal(priceLevelToEstimate("PRICE_LEVEL_UNSPECIFIED"), 0);
  });

  it("mapGooglePlace produces hotel row shape", () => {
    const row = mapGooglePlace(
      { segment: "D5", checkIn: "2026-10-05", checkOut: "2026-10-06" },
      {
        id: "places/abc",
        displayName: { text: "唐布拉草原放蜂人家" },
        formattedAddress: "尼勒克县唐布拉",
        rating: 4.6,
        userRatingCount: 128,
        googleMapsUri: "https://maps.google.com/?q=1",
        priceLevel: "PRICE_LEVEL_MODERATE",
        types: ["lodging", "guest_house"],
      },
      1,
      "唐布拉 民宿"
    );
    assert.equal(row.source, "google");
    assert.equal(row.name, "唐布拉草原放蜂人家");
    assert.equal(row.reviewScore, "4.6");
    assert.equal(row.lodgingType, "民宿");
  });

  it("mergeHotelSources prefers fly.ai price over Google estimate", () => {
    const flyai = [
      {
        name: "唐布拉草原放蜂人家民宿",
        priceNum: 285,
        price: "¥285",
        source: "flyai",
        url: "https://feizhu.example/1",
      },
    ];
    const google = [
      {
        name: "唐布拉草原放蜂人家",
        priceNum: 350,
        price: "≈¥350",
        priceIsEstimate: true,
        source: "google",
        reviewScore: "4.7",
        url: "https://maps.google.com/?q=1",
      },
    ];
    const merged = mergeHotelSources(flyai, google);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].priceNum, 285);
    assert.equal(merged[0].reviewScore, "4.7");
    assert.equal(merged[0].source, "both");
  });

  it("normalizeHotelName strips punctuation", () => {
    assert.equal(normalizeHotelName("全季（博乐）"), normalizeHotelName("全季博乐"));
  });
});
