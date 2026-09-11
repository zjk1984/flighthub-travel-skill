#!/usr/bin/env node
/**
 * Re-query scenic homestay segments (D2/D4/D6) and merge into hotels JSON.
 */
const fs = require("fs");
const path = require("path");
const { loadConfig } = require("./load-monitor-config");
const { sleep } = require("./search-queue");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "reports/xinjiang-hotels-latest.json");

// Reuse monitor helpers
const monitor = require("./monitor-hotels.js");

async function main() {
  const cfg = loadConfig();
  const trip = cfg.trip;
  const scenicSegs = (trip.hotels || []).filter((s) => s.scenicHomestay && !s.skipMonitor);
  if (!scenicSegs.length) {
    process.stderr.write("No scenic homestay segments\n");
    return;
  }

  let existing = [];
  if (fs.existsSync(OUT)) {
    existing = JSON.parse(fs.readFileSync(OUT, "utf8")).filter(
      (h) => !scenicSegs.some((s) => s.segment === h.segment)
    );
  }

  const hotelOverrides = trip.hotelOverrides || {};
  const fresh = [];
  for (const seg of scenicSegs) {
    process.stderr.write(`Scenic refresh: ${seg.segment}\n`);
    const rows = await monitor.searchSegment(seg, trip.scoringProfile === "family_elder", hotelOverrides);
    fresh.push(...rows);
    process.stderr.write(`  → ${rows.length} candidates\n`);
    await sleep(3000);
  }

  const merged = [...existing, ...fresh];
  fs.writeFileSync(OUT, JSON.stringify(merged, null, 2) + "\n");
  process.stderr.write(`Saved ${OUT} (${merged.length} rows, ${fresh.length} scenic)\n`);

  const { spawnSync } = require("child_process");
  const rankedOut = OUT.replace(/\.json$/, "-ranked.md");
  spawnSync("node", [path.join(__dirname, "format-hotels-ranked.js"), OUT, "--out", rankedOut], {
    encoding: "utf8",
    cwd: ROOT,
  });
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { main };
