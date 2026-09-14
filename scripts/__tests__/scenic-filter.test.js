const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { filterScenicHomestays } = require("../monitor-hotels");

const kalajunSeg = {
  segment: "D3-D4 喀拉峻",
  scenicHomestay: true,
  scenicPoi: "喀拉峻",
};

function row(name, address) {
  return { name, address, location: address, segment: kalajunSeg.segment };
}

describe("filterScenicHomestays Kalajun", () => {
  it("keeps 山涧云海 / 霍斯宝 / 云雾牧 even when address mentions 八卦城", () => {
    const rows = [
      row("山涧云海民宿", "特克斯县八卦城喀拉达拉乡"),
      row("霍斯宝民宿", "特克斯县八卦城附近"),
      row("云雾牧民宿", "特克斯八卦城牧业村"),
      row("特克斯县人民政府招待所", "特克斯县八卦城县人民政府"),
    ];
    const kept = filterScenicHomestays(rows, kalajunSeg).map((h) => h.name);
    assert.ok(kept.includes("山涧云海民宿"));
    assert.ok(kept.includes("霍斯宝民宿"));
    assert.ok(kept.includes("云雾牧民宿"));
    assert.ok(!kept.includes("特克斯县人民政府招待所"));
  });
});
