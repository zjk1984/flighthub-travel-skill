#!/usr/bin/env node
/**
 * Build custom transfer itineraries and append to monitor JSONL results.
 *
 * Strategy:
 * 1. From origin (or Xinjiang city on return), pick top-N cheapest first-leg flights to hub cities
 * 2. Search unique hub → destination second-leg routes once
 * 3. Combine valid connections (min/max layover) into synthetic "自定义中转" candidates
 *
 * Usage: node scripts/custom-transfer.js <results.jsonl>
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { loadConfig } = require("./load-monitor-config");

const ROOT = path.join(__dirname, "..");
const ADAPTIVE_SEARCH = path.join(__dirname, "flyai-adaptive-search.sh");
const CFG = loadConfig();
const CT = CFG.customTransfer;

function parseJsonl(raw) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (raw[i] === "}") {
      depth--;
      if (depth === 0) parts.push(raw.slice(start, i + 1));
    }
  }
  return parts.map((p) => JSON.parse(p));
}

function parsePrice(p) {
  return parseFloat(String(p).replace(/[^0-9.]/g, "")) || 0;
}

function parseDt(str) {
  return new Date(str.replace(" ", "T"));
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function routeKey(route, date) {
  return `${route}|${date}`;
}

function leg2NeedKey(hub, dest, date) {
  return `${hub}|${dest}|${date}`;
}

function buildRouteMap(results) {
  const map = new Map();
  for (const r of results) {
    const key = routeKey(r.route, r.date);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...r, flights: [...(r.flights || [])] });
      continue;
    }
    const seen = new Set((existing.flights || []).map((f) => `${f.depDateTime}|${f.flightNo}`));
    for (const f of r.flights || []) {
      const fk = `${f.depDateTime}|${f.flightNo}`;
      if (!seen.has(fk)) {
        existing.flights.push(f);
        seen.add(fk);
      }
    }
    existing.apiCount = (existing.apiCount || 0) + (r.apiCount || 0);
  }
  return map;
}

function runAdaptiveSearch(origin, dest, date, journeyType = 2) {
  const env = {
    ...process.env,
    FLYAI: process.env.FLYAI || "npx flyai",
    DEDUP: path.join(__dirname, "flyai-dedup.js"),
  };
  try {
    const out = execFileSync("bash", [ADAPTIVE_SEARCH, origin, dest, date, String(journeyType)], {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(out.trim());
  } catch (e) {
    const stdout = e.stdout ? String(e.stdout) : "";
    if (stdout.trim()) {
      try {
        return JSON.parse(stdout.trim());
      } catch (_) {
        /* fall through */
      }
    }
    return { route: `${origin}→${dest}`, date, apiCount: 0, dedup: "error", flights: [] };
  }
}

function ensureRoute(map, results, origin, dest, date) {
  const key = routeKey(`${origin}→${dest}`, date);
  if (map.has(key)) return false;
  process.stderr.write(`Custom transfer leg2: ${origin} → ${dest} | ${date}\n`);
  const r = runAdaptiveSearch(origin, dest, date, 2);
  results.push(r);
  map.set(key, r);
  return true;
}

function collectLeg1Flights(map, fromCity, date, hubs, excludeCity) {
  const flights = [];
  for (const hub of hubs) {
    if (hub === excludeCity) continue;
    const r = map.get(routeKey(`${fromCity}→${hub}`, date));
    if (!r) continue;
    for (const f of r.flights || []) {
      flights.push({
        ...f,
        hubCity: hub,
        priceNum: parsePrice(f.price),
      });
    }
  }
  return flights.sort((a, b) => a.priceNum - b.priceNum || a.depDateTime.localeCompare(b.depDateTime));
}

function legDatesForPair(leg1) {
  const arrDay = leg1.arrDateTime.slice(0, 10);
  const dates = [arrDay];
  if (CT.leg2NextDayIfNeeded) {
    const next = addDays(arrDay, 1);
    if (!dates.includes(next)) dates.push(next);
  }
  return dates;
}

function combinePair(leg1, leg2, transitCity) {
  const arr1 = parseDt(leg1.arrDateTime);
  const dep2 = parseDt(leg2.depDateTime);
  const connectionMin = (dep2 - arr1) / 60000;
  if (connectionMin < CT.minConnectionMinutes || connectionMin > CT.maxConnectionMinutes) {
    return null;
  }

  const priceNum = parsePrice(leg1.price) + parsePrice(leg2.price);

  return {
    depDateTime: leg1.depDateTime,
    arrDateTime: leg2.arrDateTime,
    depStation: leg1.depStation,
    arrStation: leg2.arrStation,
    depStationCode: leg1.depStationCode,
    arrStationCode: leg2.arrStationCode,
    flightNo: `${leg1.flightNo} + ${leg2.flightNo}`,
    airline: `${leg1.airline} + ${leg2.airline}`,
    journeyType: "自定义中转",
    customTransfer: true,
    transitCity,
    connectionMin: Math.round(connectionMin),
    duration: "",
    price: priceNum.toFixed(2),
    jumpUrl: leg2.jumpUrl || leg1.jumpUrl || "",
    segments: [...(leg1.segments || []), ...(leg2.segments || [])],
    leg1FlightNo: leg1.flightNo,
    leg2FlightNo: leg2.flightNo,
  };
}

function planOutboundLeg2Needs(map) {
  const needs = new Set();
  for (const date of CFG.outboundDates) {
    for (const origin of CFG.origins) {
      for (const finalDest of CFG.destinations) {
        const leg1Candidates = collectLeg1Flights(map, origin, date, CT.transferHubs, finalDest).slice(
          0,
          CT.firstLegTopN
        );
        for (const leg1 of leg1Candidates) {
          for (const leg2Date of legDatesForPair(leg1)) {
            needs.add(leg2NeedKey(leg1.hubCity, finalDest, leg2Date));
          }
        }
      }
    }
  }
  return needs;
}

function planInboundLeg2Needs(map) {
  const needs = new Set();
  for (const date of CFG.returnDates) {
    for (const xjCity of CFG.destinations) {
      for (const guangdongCity of CFG.origins) {
        const leg1Candidates = collectLeg1Flights(map, xjCity, date, CT.transferHubs, guangdongCity).slice(
          0,
          CT.firstLegTopN
        );
        for (const leg1 of leg1Candidates) {
          for (const leg2Date of legDatesForPair(leg1)) {
            needs.add(leg2NeedKey(leg1.hubCity, guangdongCity, leg2Date));
          }
        }
      }
    }
  }
  return needs;
}

function prefetchLeg2Routes(map, results, needs) {
  let fetched = 0;
  for (const need of needs) {
    const [hub, dest, date] = need.split("|");
    if (ensureRoute(map, results, hub, dest, date)) fetched++;
  }
  return fetched;
}

function buildOutboundCustom(map, origin, date, finalDest) {
  const leg1Candidates = collectLeg1Flights(map, origin, date, CT.transferHubs, finalDest).slice(
    0,
    CT.firstLegTopN
  );
  if (!leg1Candidates.length) return [];

  const combined = [];
  const seen = new Set();

  for (const leg1 of leg1Candidates) {
    const hub = leg1.hubCity;
    for (const leg2Date of legDatesForPair(leg1)) {
      const leg2Route = map.get(routeKey(`${hub}→${finalDest}`, leg2Date));
      if (!leg2Route) continue;
      for (const leg2 of leg2Route.flights || []) {
        const combo = combinePair(leg1, leg2, hub);
        if (!combo) continue;
        const dedupeKey = `${combo.depDateTime}|${combo.flightNo}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        combined.push(combo);
      }
    }
  }
  return combined;
}

function buildInboundCustom(map, xjCity, date, guangdongCity) {
  const leg1Candidates = collectLeg1Flights(map, xjCity, date, CT.transferHubs, guangdongCity).slice(
    0,
    CT.firstLegTopN
  );
  if (!leg1Candidates.length) return [];

  const combined = [];
  const seen = new Set();

  for (const leg1 of leg1Candidates) {
    const hub = leg1.hubCity;
    for (const leg2Date of legDatesForPair(leg1)) {
      const leg2Route = map.get(routeKey(`${hub}→${guangdongCity}`, leg2Date));
      if (!leg2Route) continue;
      for (const leg2 of leg2Route.flights || []) {
        const combo = combinePair(leg1, leg2, hub);
        if (!combo) continue;
        const dedupeKey = `${combo.depDateTime}|${combo.flightNo}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        combined.push(combo);
      }
    }
  }
  return combined;
}

function mergeFlightsIntoResults(results, map, route, date, flights, label) {
  if (!flights.length) return null;
  const key = routeKey(route, date);
  const existing = map.get(key);
  if (existing && existing.flights) {
    const existKeys = new Set(existing.flights.map((f) => `${f.depDateTime}|${f.flightNo}`));
    let added = 0;
    for (const f of flights) {
      const k = `${f.depDateTime}|${f.flightNo}`;
      if (!existKeys.has(k)) {
        existing.flights.push(f);
        existKeys.add(k);
        added++;
      }
    }
    if (added > 0) {
      existing.dedup = `${existing.dedup || ""}; ${label} +${added}`.trim();
    }
    return added > 0 ? existing : null;
  }
  const entry = {
    route,
    date,
    apiCount: 0,
    dedup: `${label}: ${flights.length} 条`,
    flights,
  };
  results.push(entry);
  map.set(key, entry);
  return entry;
}

function appendCustomResults(results, map) {
  const appended = [];
  const leg2Needs = new Set([...planOutboundLeg2Needs(map), ...planInboundLeg2Needs(map)]);
  const fetched = prefetchLeg2Routes(map, results, leg2Needs);
  process.stderr.write(`Custom transfer leg2: ${leg2Needs.size} unique routes, ${fetched} fetched\n`);

  for (const date of CFG.outboundDates) {
    for (const origin of CFG.origins) {
      for (const dest of CFG.destinations) {
        const flights = buildOutboundCustom(map, origin, date, dest);
        const entry = mergeFlightsIntoResults(
          results,
          map,
          `${origin}→${dest}`,
          date,
          flights,
          "custom-transfer"
        );
        if (entry) appended.push(entry);
      }
    }
  }

  for (const date of CFG.returnDates) {
    for (const dest of CFG.destinations) {
      for (const origin of CFG.origins) {
        const flights = buildInboundCustom(map, dest, date, origin);
        const entry = mergeFlightsIntoResults(
          results,
          map,
          `${dest}→${origin}`,
          date,
          flights,
          "custom-transfer"
        );
        if (entry) appended.push(entry);
      }
    }
  }

  return appended;
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node scripts/custom-transfer.js <results.jsonl>");
    process.exit(1);
  }
  if (!CT.enabled) {
    process.stderr.write("Custom transfer disabled in config\n");
    return;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const results = parseJsonl(raw);
  const map = buildRouteMap(results);

  process.stderr.write(
    `Custom transfer: top${CT.firstLegTopN} leg1 via [${CT.transferHubs.join("、")}]\n`
  );

  appendCustomResults(results, map);

  const customCount = results.reduce(
    (n, r) => n + (r.flights || []).filter((f) => f.customTransfer).length,
    0
  );
  process.stderr.write(`Custom transfer: merged ${customCount} combined itineraries\n`);

  const out = results.map((r) => JSON.stringify(r)).join("\n") + "\n";
  fs.writeFileSync(filePath, out);
}

main();
