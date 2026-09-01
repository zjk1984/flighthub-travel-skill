#!/usr/bin/env node
/**
 * Build custom transfer itineraries (optimized).
 * P0: jt=2 hub leg1, destination-aware top3, conditional leg2/next-day
 * P1: concurrent leg2, API dedupe, segment price fields, skip if enough main results
 * P2: leg2 cache, JSONL compact
 */
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { loadConfig } = require("./load-monitor-config");

const execFileAsync = promisify(execFile);
const ROOT = path.join(__dirname, "..");
const ADAPTIVE_SEARCH = path.join(__dirname, "flyai-adaptive-search.sh");
const LEG2_CACHE_PATH = path.join(ROOT, "reports/leg2-cache.jsonl");
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

function normalizeFlightNos(flightNo) {
  return String(flightNo || "")
    .split(/[/+]/).map((s) => s.trim()).filter(Boolean)
    .sort().join("|");
}

function itinerarySignature(f) {
  if (f.customTransfer) {
    return `CT|${f.depDateTime}|${normalizeFlightNos(f.leg1FlightNo)}|${normalizeFlightNos(f.leg2FlightNo)}`;
  }
  return `API|${f.depDateTime}|${normalizeFlightNos(f.flightNo)}`;
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

async function runAdaptiveSearch(origin, dest, date, journeyType = 2) {
  const env = {
    ...process.env,
    FLYAI: process.env.FLYAI || "npx flyai",
    DEDUP: path.join(__dirname, "flyai-dedup.js"),
  };
  try {
    const { stdout } = await execFileAsync(
      "bash",
      [ADAPTIVE_SEARCH, origin, dest, date, String(journeyType)],
      { encoding: "utf8", env, maxBuffer: 10 * 1024 * 1024 }
    );
    return JSON.parse(stdout.trim());
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

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

function loadLeg2Cache() {
  if (!CT.leg2CacheEnabled || !fs.existsSync(LEG2_CACHE_PATH)) return new Map();
  const map = new Map();
  try {
    const raw = fs.readFileSync(LEG2_CACHE_PATH, "utf8");
    for (const line of raw.split("\n").filter(Boolean)) {
      const row = JSON.parse(line);
      map.set(leg2NeedKey(row.hub, row.dest, row.date), row);
    }
  } catch (_) {
    /* ignore corrupt cache */
  }
  return map;
}

function appendLeg2Cache(entries) {
  if (!CT.leg2CacheEnabled || !entries.length) return;
  fs.mkdirSync(path.dirname(LEG2_CACHE_PATH), { recursive: true });
  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.appendFileSync(LEG2_CACHE_PATH, lines);
}

function countMainFlights(map, route, date) {
  const entry = map.get(routeKey(route, date));
  if (!entry) return 0;
  return (entry.flights || []).filter((f) => !f.customTransfer).length;
}

function needsCustomTransfer(map, route, date) {
  const key = routeKey(route, date);
  if (!map.has(key)) return false;
  const threshold = CT.skipIfMainResultsAtLeast;
  if (threshold <= 0) return true;
  return countMainFlights(map, route, date) < threshold;
}

function collectActiveContexts(map) {
  const outbound = new Set();
  const inbound = new Set();
  let any = false;

  for (const date of CFG.outboundDates) {
    for (const origin of CFG.origins) {
      for (const dest of CFG.destinations) {
        const route = `${origin}→${dest}`;
        if (needsCustomTransfer(map, route, date)) {
          outbound.add(`${origin}|${date}`);
          any = true;
        }
      }
    }
  }
  for (const date of CFG.returnDates) {
    for (const dest of CFG.destinations) {
      for (const origin of CFG.origins) {
        const route = `${dest}→${origin}`;
        if (needsCustomTransfer(map, route, date)) {
          inbound.add(`${dest}|${date}`);
          any = true;
        }
      }
    }
  }
  return { outbound, inbound, any };
}

function hubLeg1SearchTasks(active) {
  const tasks = [];
  const seen = new Set();

  for (const ctx of active.outbound) {
    const [origin, date] = ctx.split("|");
    for (const hub of CT.transferHubs) {
      if (CFG.destinations.includes(hub)) continue;
      const key = `${origin}→${hub}|${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push({ origin, dest: hub, date, kind: "hub-leg1" });
    }
  }
  for (const ctx of active.inbound) {
    const [xjCity, date] = ctx.split("|");
    for (const hub of CT.transferHubs) {
      if (hub === xjCity) continue;
      const key = `${xjCity}→${hub}|${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push({ origin: xjCity, dest: hub, date, kind: "hub-leg1" });
    }
  }
  return tasks;
}

async function ensureRoutes(map, results, tasks, journeyType = 2) {
  const toFetch = tasks.filter(({ origin, dest, date }) => !map.has(routeKey(`${origin}→${dest}`, date)));
  if (!toFetch.length) return 0;

  await mapPool(toFetch, CT.leg2Concurrency, async ({ origin, dest, date }) => {
    process.stderr.write(`Custom transfer search: ${origin} → ${dest} | ${date} | jt=${journeyType}\n`);
    const r = await runAdaptiveSearch(origin, dest, date, journeyType);
    results.push(r);
    map.set(routeKey(r.route, r.date), { ...r, flights: [...(r.flights || [])] });
  });
  return toFetch.length;
}

function cheapestPerHub(map, fromCity, date, hubs, excludeCity) {
  const perHub = [];
  for (const hub of hubs) {
    if (hub === excludeCity) continue;
    const flights = map.get(routeKey(`${fromCity}→${hub}`, date))?.flights || [];
    if (!flights.length) continue;
    const best = flights.reduce((a, b) => (parsePrice(a.price) <= parsePrice(b.price) ? a : b));
    perHub.push({
      ...best,
      hubCity: hub,
      priceNum: parsePrice(best.price),
    });
  }
  return perHub;
}

function legDatesForPair(leg1, sameDayHasValidPair) {
  const arrDay = leg1.arrDateTime.slice(0, 10);
  const dates = [arrDay];
  const hour = parseInt(leg1.arrDateTime.slice(11, 13), 10);
  const needNext =
    CT.leg2NextDayIfNeeded &&
    (hour >= CT.lateArrivalHour || sameDayHasValidPair === false);
  if (needNext) {
    const next = addDays(arrDay, 1);
    if (!dates.includes(next)) dates.push(next);
  }
  return dates;
}

function minLeg2Price(map, hub, dest, dates) {
  let min = Infinity;
  for (const d of dates) {
    const flights = map.get(routeKey(`${hub}→${dest}`, d))?.flights || [];
    for (const f of flights) min = Math.min(min, parsePrice(f.price));
  }
  return min;
}

function rankLeg1ForDestination(map, perHubLeg1, finalDest) {
  const ranked = perHubLeg1.map((leg1) => {
    const dates = legDatesForPair(leg1, null);
    const leg2Min = minLeg2Price(map, leg1.hubCity, finalDest, dates);
    const estimate = leg1.priceNum + (leg2Min === Infinity ? 99999 : leg2Min);
    return { ...leg1, estimate, leg2Min };
  });
  ranked.sort((a, b) => a.estimate - b.estimate || a.priceNum - b.priceNum);
  return ranked.slice(0, CT.firstLegTopN);
}

function combinePair(leg1, leg2, transitCity) {
  const arr1 = parseDt(leg1.arrDateTime);
  const dep2 = parseDt(leg2.depDateTime);
  const connectionMin = (dep2 - arr1) / 60000;
  if (connectionMin < CT.minConnectionMinutes || connectionMin > CT.maxConnectionMinutes) {
    return null;
  }

  const leg1PriceNum = parsePrice(leg1.price);
  const leg2PriceNum = parsePrice(leg2.price);

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
    price: (leg1PriceNum + leg2PriceNum).toFixed(2),
    leg1PriceNum,
    leg2PriceNum,
    leg1JumpUrl: leg1.jumpUrl || "",
    leg2JumpUrl: leg2.jumpUrl || "",
    jumpUrl: leg2.jumpUrl || leg1.jumpUrl || "",
    segments: [...(leg1.segments || []), ...(leg2.segments || [])],
    leg1FlightNo: leg1.flightNo,
    leg2FlightNo: leg2.flightNo,
  };
}

function hasSameDayConnection(leg1, map, hub, dest) {
  const arrDay = leg1.arrDateTime.slice(0, 10);
  const leg2flights = map.get(routeKey(`${hub}→${dest}`, arrDay))?.flights || [];
  return leg2flights.some((leg2) => combinePair(leg1, leg2, hub));
}

function planLeg2Needs(map, active) {
  const needs = new Set();

  for (const date of CFG.outboundDates) {
    for (const origin of CFG.origins) {
      for (const finalDest of CFG.destinations) {
        const route = `${origin}→${finalDest}`;
        if (!needsCustomTransfer(map, route, date)) continue;
        const perHub = cheapestPerHub(map, origin, date, CT.transferHubs, finalDest);
        const leg1Ranked = rankLeg1ForDestination(map, perHub, finalDest);
        for (const leg1 of leg1Ranked) {
          const sameDayOk = hasSameDayConnection(leg1, map, leg1.hubCity, finalDest);
          for (const leg2Date of legDatesForPair(leg1, sameDayOk)) {
            needs.add(leg2NeedKey(leg1.hubCity, finalDest, leg2Date));
          }
        }
      }
    }
  }

  for (const date of CFG.returnDates) {
    for (const xjCity of CFG.destinations) {
      for (const gdCity of CFG.origins) {
        const route = `${xjCity}→${gdCity}`;
        if (!needsCustomTransfer(map, route, date)) continue;
        const perHub = cheapestPerHub(map, xjCity, date, CT.transferHubs, gdCity);
        const leg1Ranked = rankLeg1ForDestination(map, perHub, gdCity);
        for (const leg1 of leg1Ranked) {
          const sameDayOk = hasSameDayConnection(leg1, map, leg1.hubCity, gdCity);
          for (const leg2Date of legDatesForPair(leg1, sameDayOk)) {
            needs.add(leg2NeedKey(leg1.hubCity, gdCity, leg2Date));
          }
        }
      }
    }
  }

  return [...needs].map((k) => {
    const [hub, dest, d] = k.split("|");
    return { hub, dest, date: d };
  });
}

async function prefetchLeg2(map, results, needs, cache) {
  const cacheHits = [];
  const toFetch = [];

  for (const n of needs) {
    const key = leg2NeedKey(n.hub, n.dest, n.date);
    const rk = routeKey(`${n.hub}→${n.dest}`, n.date);
    if (map.has(rk)) continue;
    if (cache.has(key)) {
      const cached = cache.get(key);
      results.push(cached.result);
      map.set(rk, { ...cached.result, flights: [...(cached.result.flights || [])] });
      cacheHits.push(key);
      continue;
    }
    toFetch.push(n);
  }

  const fetchedEntries = [];
  await mapPool(toFetch, CT.leg2Concurrency, async ({ hub, dest, date }) => {
    process.stderr.write(`Custom transfer leg2: ${hub} → ${dest} | ${date}\n`);
    const r = await runAdaptiveSearch(hub, dest, date, 2);
    results.push(r);
    map.set(routeKey(r.route, r.date), { ...r, flights: [...(r.flights || [])] });
    fetchedEntries.push({ hub, dest, date, result: r, cachedAt: new Date().toISOString() });
  });

  appendLeg2Cache(fetchedEntries);
  return { fetched: toFetch.length, cacheHits: cacheHits.length };
}

function existingSignaturesForRoute(map, route, date) {
  const sigs = new Set();
  const flights = map.get(routeKey(route, date))?.flights || [];
  for (const f of flights) {
    if (!f.customTransfer) sigs.add(itinerarySignature(f));
  }
  return sigs;
}

function buildCombos(map, fromCity, date, leg2Dest, excludeHub) {
  const route = `${fromCity}→${leg2Dest}`;
  if (!needsCustomTransfer(map, route, date)) return [];

  const perHub = cheapestPerHub(map, fromCity, date, CT.transferHubs, excludeHub);
  const leg1Ranked = rankLeg1ForDestination(map, perHub, leg2Dest);
  const apiSigs = existingSignaturesForRoute(map, route, date);
  const combined = [];
  const seen = new Set();

  for (const leg1 of leg1Ranked) {
    const hub = leg1.hubCity;
    const sameDayOk = hasSameDayConnection(leg1, map, hub, leg2Dest);
    for (const leg2Date of legDatesForPair(leg1, sameDayOk)) {
      const leg2flights = map.get(routeKey(`${hub}→${leg2Dest}`, leg2Date))?.flights || [];
      for (const leg2 of leg2flights) {
        const combo = combinePair(leg1, leg2, hub);
        if (!combo) continue;
        if (apiSigs.has(itinerarySignature(combo))) continue;
        const dedupeKey = `${combo.depDateTime}|${combo.flightNo}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        combined.push(combo);
      }
    }
  }

  combined.sort((a, b) => parsePrice(a.price) - parsePrice(b.price));
  return combined.slice(0, CT.maxCombosPerRoute);
}

function buildOutboundCustom(map, origin, date, finalDest) {
  return buildCombos(map, origin, date, finalDest, finalDest);
}

function buildInboundCustom(map, xjCity, date, gdCity) {
  return buildCombos(map, xjCity, date, gdCity, gdCity);
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
    if (added > 0) existing.dedup = `${existing.dedup || ""}; ${label} +${added}`.trim();
    return added > 0 ? existing : null;
  }
  const entry = { route, date, apiCount: 0, dedup: `${label}: ${flights.length} 条`, flights };
  results.push(entry);
  map.set(key, entry);
  return entry;
}

async function appendCustomResults(results, map) {
  const active = collectActiveContexts(map);
  if (!active.any) {
    process.stderr.write(
      `Custom transfer: skipped (all routes have ≥${CT.skipIfMainResultsAtLeast} main results)\n`
    );
    return 0;
  }

  const hubTasks = hubLeg1SearchTasks(active);
  const hubFetched = await ensureRoutes(map, results, hubTasks, 2);
  process.stderr.write(`Custom transfer hub leg1: ${hubTasks.length} planned, ${hubFetched} fetched (jt=2)\n`);

  const leg2Needs = planLeg2Needs(map, active);
  const cache = loadLeg2Cache();
  const { fetched, cacheHits } = await prefetchLeg2(map, results, leg2Needs, cache);
  process.stderr.write(
    `Custom transfer leg2: ${leg2Needs.length} unique, ${fetched} fetched, ${cacheHits} cache hits\n`
  );

  let merged = 0;
  for (const date of CFG.outboundDates) {
    for (const origin of CFG.origins) {
      for (const dest of CFG.destinations) {
        const flights = buildOutboundCustom(map, origin, date, dest);
        if (mergeFlightsIntoResults(results, map, `${origin}→${dest}`, date, flights, "custom-transfer")) {
          merged += flights.length;
        }
      }
    }
  }
  for (const date of CFG.returnDates) {
    for (const dest of CFG.destinations) {
      for (const origin of CFG.origins) {
        const flights = buildInboundCustom(map, dest, date, origin);
        if (mergeFlightsIntoResults(results, map, `${dest}→${origin}`, date, flights, "custom-transfer")) {
          merged += flights.length;
        }
      }
    }
  }
  return merged;
}

async function main() {
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
    `Custom transfer: top${CT.firstLegTopN} per-dest | hubs [${CT.transferHubs.join("、")}] | ` +
      `skip if main≥${CT.skipIfMainResultsAtLeast}\n`
  );

  const merged = await appendCustomResults(results, map);
  const compacted = [...map.values()];
  const customCount = compacted.reduce(
    (n, r) => n + (r.flights || []).filter((f) => f.customTransfer).length,
    0
  );
  process.stderr.write(`Custom transfer: merged ${merged} combos, ${customCount} total in cache\n`);

  fs.writeFileSync(filePath, compacted.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
