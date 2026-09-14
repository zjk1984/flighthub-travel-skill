const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("child_process");
const path = require("path");

const scriptsDir = path.join(__dirname, "..");

describe("trip_map_sync", () => {
  it("patches D4/D6/D7 subtitles with booked hotel names", () => {
    const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(scriptsDir)})
from trip_map_sync import apply_trip_to_subtitles, hotel_override_for_card, load_trip, short_hotel_name
trip = load_trip()
d6 = hotel_override_for_card(trip, "D6")
d7 = hotel_override_for_card(trip, "D7")
assert d6 and "喀兰朵" in d6["name"], d6
assert d7 and "喀兰朵" in d7["name"], d7
subs = apply_trip_to_subtitles([
    {"day": "D4", "subtitle": "old", "subtitle_short": "old", "active_scenics": []},
    {"day": "D6", "subtitle": "old", "subtitle_short": "old", "active_scenics": [{"type": "hotel", "name": "东门"}]},
    {"day": "D7", "subtitle": "old", "subtitle_short": "old", "active_scenics": [{"hotel": "宿 东门"}]},
])
print(json.dumps(subs, ensure_ascii=False))
`;
    const out = execFileSync("python3", ["-c", py], { encoding: "utf8" });
    const subs = JSON.parse(out);
    const d4 = subs.find((s) => s.day === "D4");
    const d6 = subs.find((s) => s.day === "D6");
    const d7 = subs.find((s) => s.day === "D7");
    assert.match(d4.subtitle, /山涧云海/);
    assert.match(d6.subtitle, /喀兰朵/);
    assert.match(d6.subtitle, /不入园/);
    assert.match(d7.subtitle, /喀兰朵/);
    assert.match(d7.subtitle, /南门出园/);
    assert.ok(d6.active_scenics[0].name.includes("喀兰朵"));
  });
});
