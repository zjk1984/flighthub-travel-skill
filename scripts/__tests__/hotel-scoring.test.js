const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  getHotelProfile,
  scoreHotelsInSegment,
  locationPoints,
  comfortPoints,
  parsePriceNum,
} = require("../hotel-scoring");

describe("hotel-scoring", () => {
  it("parsePriceNum handles yen strings", () => {
    assert.equal(parsePriceNum("¥432"), 432);
  });

  it("family_elder boosts airport hotel on late arrival segment", () => {
    const profile = getHotelProfile("family_elder");
    const airport = locationPoints(
      { segment: "10/1 晚到", poi: "近伊宁国际机场", name: "星程伊宁宁远路国际机场酒店" },
      { poiPrefer: ["机场", "伊宁站"] }
    );
    const downtown = locationPoints(
      { segment: "10/1 晚到", poi: "近汉宾公园", name: "某市区酒店" },
      { poiPrefer: ["机场", "伊宁站"] }
    );
    assert.ok(airport > downtown);
  });

  it("scores chain comfort higher for family_elder", () => {
    const profile = getHotelProfile("family_elder");
    assert.ok(comfortPoints("舒适型", profile) > comfortPoints("经济型", profile));
  });

  it("ranks 全季 above 青旅 for elder segment", () => {
    const profile = getHotelProfile("family_elder");
    const meta = { poiPrefer: ["机场"] };
    const hotels = [
      {
        segment: "10/1 晚到",
        checkin: "2026-10-01",
        checkout: "2026-10-02",
        name: "知原青旅",
        priceNum: 200,
        star: "经济型",
        poi: "近赛里木湖",
        reviewScore: "4.5",
      },
      {
        segment: "10/1 晚到",
        checkin: "2026-10-01",
        checkout: "2026-10-02",
        name: "全季伊宁北京路酒店",
        priceNum: 432,
        star: "舒适型",
        poi: "近伊犁哈萨克自治州博物馆",
        reviewScore: "4.8",
      },
    ];
    const scored = scoreHotelsInSegment(hotels, profile, meta, 5);
    assert.equal(scored[0].name, "全季伊宁北京路酒店");
  });

  it("explicit roomCount overrides default ceil(party/2)", () => {
    const profile = getHotelProfile("family_elder");
    const hotels = [{ name: "测试酒店", priceNum: 300, checkin: "2026-10-01", checkout: "2026-10-02", star: "舒适型" }];
    const scored = scoreHotelsInSegment(hotels, profile, { segment: "test" }, 5, 2);
    assert.equal(scored[0].roomEstimate, 2);
    assert.equal(scored[0].stayTotal, 600);
  });
});
