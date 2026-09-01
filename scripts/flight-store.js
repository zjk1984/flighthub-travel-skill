/**
 * Unified JSONL flight result store: parse, merge routes, signature dedupe.
 */
const fs = require("fs");

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

function routeKey(route, date) {
  return `${route}|${date}`;
}

function parsePrice(p) {
  return parseFloat(String(p).replace(/[^0-9.]/g, "")) || 0;
}

function normalizeFlightNos(flightNo) {
  return String(flightNo || "")
    .split(/[/+]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .sort()
    .join("|");
}

function flightSignature(f) {
  if (f.customTransfer) {
    return `CT|${f.depDateTime}|${normalizeFlightNos(f.leg1FlightNo)}|${normalizeFlightNos(f.leg2FlightNo)}`;
  }
  return `API|${f.depDateTime}|${normalizeFlightNos(f.flightNo)}`;
}

function apiEquivalentSignature(f) {
  if (f.customTransfer) {
    return `API|${f.depDateTime}|${normalizeFlightNos(f.leg1FlightNo)}|${normalizeFlightNos(f.leg2FlightNo)}`;
  }
  return flightSignature(f);
}

function buildRouteMap(results) {
  const map = new Map();
  for (const r of results) mergeRouteEntry(map, r);
  return map;
}

function mergeRouteEntry(map, entry) {
  const key = routeKey(entry.route, entry.date);
  const existing = map.get(key);
  if (!existing) {
    map.set(key, { ...entry, flights: [...(entry.flights || [])] });
    return;
  }
  addFlightsToEntry(existing, entry.flights || []);
  existing.apiCount = (existing.apiCount || 0) + (entry.apiCount || 0);
  if (entry.dedup && entry.dedup !== existing.dedup) {
    existing.dedup = `${existing.dedup || ""}; ${entry.dedup}`.trim();
  }
}

function addFlightsToEntry(entry, flights, { skipSignatures } = {}) {
  const seen = new Set((entry.flights || []).map((f) => flightSignature(f)));
  const skip = skipSignatures || new Set();
  let added = 0;
  for (const f of flights) {
    const sig = flightSignature(f);
    const apiSig = apiEquivalentSignature(f);
    if (seen.has(sig) || skip.has(apiSig)) continue;
    if (!entry.flights) entry.flights = [];
    entry.flights.push(f);
    seen.add(sig);
    added++;
  }
  return added;
}

function compactMap(map) {
  return [...map.values()];
}

function loadFromFile(filePath) {
  if (!fs.existsSync(filePath)) return new Map();
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) return new Map();
  return buildRouteMap(parseJsonl(raw));
}

function saveToFile(map, filePath) {
  const lines = compactMap(map).map((r) => JSON.stringify(r)).join("\n") + "\n";
  fs.mkdirSync(require("path").dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines);
}

function flattenFlights(mapOrResults, cfg, extras = {}) {
  const { isOutboundRoute, remoteCity, parseRoute } = require("./load-monitor-config");
  const results = mapOrResults instanceof Map ? compactMap(mapOrResults) : mapOrResults;
  const seen = new Map();
  for (const r of results) {
    for (const f of r.flights || []) {
      const sig = flightSignature(f);
      if (seen.has(sig)) continue;
      const { origin, dest } = parseRoute(r.route);
      seen.set(sig, {
        ...f,
        route: r.route,
        date: r.date,
        origin,
        dest,
        xjAirport: remoteCity(r.route, cfg),
        priceNum: parsePrice(f.price),
        ...extras,
      });
    }
  }
  return [...seen.values()];
}

function countMainFlights(map, route, date) {
  const entry = map.get(routeKey(route, date));
  if (!entry) return 0;
  return (entry.flights || []).filter((f) => !f.customTransfer).length;
}

function extractTransitHubsFromFlights(flights, { origins, destinations, transferHubs }) {
  const hubSet = new Set(transferHubs || []);
  const originSet = new Set(origins || []);
  const destSet = new Set(destinations || []);

  for (const f of flights) {
    if (f.customTransfer || f.journeyType === "直达") continue;
    const segs = f.segments || [];
    if (segs.length >= 2) {
      for (let i = 0; i < segs.length - 1; i++) {
        const mid = segs[i].arrStationShortName || segs[i].arrStation || "";
        if (!mid || originSet.has(mid) || destSet.has(mid)) continue;
        hubSet.add(mid);
      }
    }
  }
  return [...hubSet];
}

module.exports = {
  parseJsonl,
  routeKey,
  parsePrice,
  normalizeFlightNos,
  flightSignature,
  apiEquivalentSignature,
  buildRouteMap,
  mergeRouteEntry,
  addFlightsToEntry,
  compactMap,
  loadFromFile,
  saveToFile,
  flattenFlights,
  countMainFlights,
  extractTransitHubsFromFlights,
};
