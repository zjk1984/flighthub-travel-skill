#!/usr/bin/env node
/**
 * Purge cached + stored results for configured return routes (force API re-fetch).
 *
 * Usage: node refresh-return-routes.js [--include-adjacent]
 */
const fs = require("fs");
const path = require("path");
const { loadConfig } = require("./load-monitor-config");
const { addDays, primaryReturnDates, inboundRoutes } = require("./return-flight-prefs");

const ROOT = path.join(__dirname, "..");
const CACHE_PATH = path.join(ROOT, "reports/flight-route-cache.jsonl");
const RESULTS_PATH = path.join(ROOT, "reports/xinjiang-results.jsonl");

function parseArgs(argv) {
  let includeAdjacent = true;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--no-adjacent") includeAdjacent = false;
    if (argv[i] === "--include-adjacent") includeAdjacent = true;
  }
  return { includeAdjacent };
}

function collectTargets(trip, cfg, includeAdjacent) {
  const dates = new Set(primaryReturnDates(trip, cfg));
  if (includeAdjacent) {
    for (const d of [...dates]) {
      dates.add(addDays(d, -1));
      dates.add(addDays(d, 1));
    }
  }
  const routes = inboundRoutes(trip);
  const targets = [];
  for (const r of routes) {
    for (const d of dates) {
      targets.push({ origin: r.origin, dest: r.dest, date: d, route: `${r.origin}→${r.dest}` });
    }
  }
  if (!targets.length) {
    for (const d of dates) {
      targets.push({ origin: "伊宁", dest: "广州", date: d, route: `伊宁→广州` });
    }
  }
  return targets;
}

function purgeFile(filePath, pred) {
  if (!fs.existsSync(filePath)) return 0;
  const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
  const kept = lines.filter((l) => {
    try {
      return !pred(JSON.parse(l));
    } catch {
      return true;
    }
  });
  fs.writeFileSync(filePath, kept.join("\n") + (kept.length ? "\n" : ""));
  return lines.length - kept.length;
}

function purgeReturnRoutes(options = {}) {
  const cfg = loadConfig();
  const trip = cfg.trip || {};
  const includeAdjacent = options.includeAdjacent !== false;
  const targets = collectTargets(trip, cfg, includeAdjacent);
  const matchTarget = (row) => {
    if (row.route) {
      return targets.some((t) => t.route === row.route && t.date === row.date);
    }
    if (row.origin && row.dest && row.date) {
      return targets.some((t) => t.origin === row.origin && t.dest === row.dest && t.date === row.date);
    }
    return false;
  };

  const cachePurged = purgeFile(CACHE_PATH, matchTarget);
  const resultsPurged = purgeFile(RESULTS_PATH, matchTarget);
  return { cachePurged, resultsPurged, targets: targets.length };
}

if (require.main === module) {
  const { includeAdjacent } = parseArgs(process.argv);
  const r = purgeReturnRoutes({ includeAdjacent });
  process.stderr.write(
    `Purged return routes: cache ${r.cachePurged}, results ${r.resultsPurged} (${r.targets} route×date keys)\n`
  );
}

module.exports = { purgeReturnRoutes, collectTargets };
