/**
 * Custom transfer builder (library) — used by monitor-run and CLI.
 */
const path = require("path");
const { loadConfig } = require("./load-monitor-config");
const {
  routeKey,
  parsePrice,
  addFlightsToEntry,
  apiEquivalentSignature,
  countMainFlights,
  extractTransitHubsFromFlights,
} = require("./flight-store");
const { runSearchQueue } = require("./search-queue");

const CFG = loadConfig();
const CT = CFG.customTransfer;

function parseDt(str) {
  return new Date(str.replace(" ", "T"));
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function hubsForDestination(finalDest, { map, fromCity, date } = {}) {
  const preferred = CT.preferredHubsByDest[finalDest] || [];
  let merged = [...new Set([...preferred, ...CT.transferHubs])];

  if (CT.dynamicHubsFromApi && map && fromCity && date) {
    const mainRoute = `${fromCity}→${finalDest}`;
    const mainFlights = (map.get(routeKey(mainRoute, date))?.flights || []).filter(
      (f) => !f.customTransfer
    );
    const fromApi = extractTransitHubsFromFlights(mainFlights, {
      origins: CFG.origins,
      destinations: CFG.destinations,
      transferHubs: CT.transferHubs,
    });
    merged = [...new Set([...merged, ...fromApi])];
  }

  return merged.filter((hub) => hub !== finalDest);
}

function needsCustomTransfer(map, route, date) {
  if (!map.has(routeKey(route, date))) return false;
  const max = CT.trigger?.maxMainResults ?? CT.skipIfMainResultsAtLeast;
  if (max <= 0) return true;
  return countMainFlights(map, route, date) < max;
}

function collectRoutesNeedingCustom(map) {
  const outbound = [];
  const inbound = [];

  for (const date of CFG.outboundDates) {
    for (const origin of CFG.origins) {
      for (const dest of CFG.destinations) {
        const route = `${origin}→${dest}`;
        if (needsCustomTransfer(map, route, date)) {
          outbound.push({ origin, dest, date, route });
        }
      }
    }
  }
  for (const date of CFG.returnDates) {
    for (const dest of CFG.destinations) {
      for (const origin of CFG.origins) {
        const route = `${dest}→${origin}`;
        if (needsCustomTransfer(map, route, date)) {
          inbound.push({ xjCity: dest, gdCity: origin, date, route });
        }
      }
    }
  }
  return { outbound, inbound };
}

function hubLeg1Tasks(map, routes, direction) {
  const tasks = [];
  const seen = new Set();

  for (const row of routes) {
    const from = direction === "outbound" ? row.origin : row.xjCity;
    const date = row.date;
    const finalDest = direction === "outbound" ? row.dest : row.gdCity;
    const hubs = hubsForDestination(finalDest, { map, fromCity: from, date });

    for (const hub of hubs) {
      if (hub === finalDest) continue;
      if (direction === "outbound" && CFG.destinations.includes(hub)) continue;
      if (direction === "inbound" && hub === from) continue;
      const key = `${from}→${hub}|${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push({ origin: from, dest: hub, date, mode: "cheap" });
    }
  }
  return tasks;
}

function cheapestPerHub(map, fromCity, date, hubs, excludeCity) {
  const perHub = [];
  for (const hub of hubs) {
    if (hub === excludeCity) continue;
    const flights = map.get(routeKey(`${fromCity}→${hub}`, date))?.flights || [];
    if (!flights.length) continue;
    const best = flights.reduce((a, b) => (parsePrice(a.price) <= parsePrice(b.price) ? a : b));
    perHub.push({ ...best, hubCity: hub, priceNum: parsePrice(best.price) });
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
    for (const f of map.get(routeKey(`${hub}→${dest}`, d))?.flights || []) {
      min = Math.min(min, parsePrice(f.price));
    }
  }
  return min;
}

function rankLeg1ForDestination(map, perHubLeg1, finalDest, fromCity, date) {
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

function planLeg2Tasks(map, routes, direction) {
  const needs = new Map();
  for (const row of routes) {
    const from = direction === "outbound" ? row.origin : row.xjCity;
    const date = row.date;
    const finalDest = direction === "outbound" ? row.dest : row.gdCity;
    const hubs = hubsForDestination(finalDest, { map, fromCity: from, date });
    const perHub = cheapestPerHub(map, from, date, hubs, finalDest);
    const leg1Ranked = rankLeg1ForDestination(map, perHub, finalDest, from, date);
    for (const leg1 of leg1Ranked) {
      const sameDayOk = hasSameDayConnection(leg1, map, leg1.hubCity, finalDest);
      for (const leg2Date of legDatesForPair(leg1, sameDayOk)) {
        const key = `${leg1.hubCity}|${finalDest}|${leg2Date}`;
        if (!needs.has(key)) {
          needs.set(key, {
            origin: leg1.hubCity,
            dest: finalDest,
            date: leg2Date,
            mode: "cheap",
          });
        }
      }
    }
  }
  return [...needs.values()];
}

function existingApiSignatures(map, route, date) {
  const sigs = new Set();
  for (const f of map.get(routeKey(route, date))?.flights || []) {
    if (!f.customTransfer) sigs.add(apiEquivalentSignature(f));
  }
  return sigs;
}

function buildCombos(map, fromCity, date, leg2Dest, excludeHub) {
  const route = `${fromCity}→${leg2Dest}`;
  if (!needsCustomTransfer(map, route, date)) return [];

  const hubs = hubsForDestination(leg2Dest, { map, fromCity, date });
  const perHub = cheapestPerHub(map, fromCity, date, hubs, excludeHub);
  const leg1Ranked = rankLeg1ForDestination(map, perHub, leg2Dest, fromCity, date);
  const apiSigs = existingApiSignatures(map, route, date);
  const combined = [];
  const seen = new Set();

  for (const leg1 of leg1Ranked) {
    const hub = leg1.hubCity;
    const sameDayOk = hasSameDayConnection(leg1, map, hub, leg2Dest);
    for (const leg2Date of legDatesForPair(leg1, sameDayOk)) {
      for (const leg2 of map.get(routeKey(`${hub}→${leg2Dest}`, leg2Date))?.flights || []) {
        const combo = combinePair(leg1, leg2, hub);
        if (!combo) continue;
        if (apiSigs.has(apiEquivalentSignature(combo))) continue;
        const dk = `${combo.depDateTime}|${combo.flightNo}`;
        if (seen.has(dk)) continue;
        seen.add(dk);
        combined.push(combo);
      }
    }
  }
  combined.sort((a, b) => parsePrice(a.price) - parsePrice(b.price));
  return combined.slice(0, CT.maxCombosPerRoute);
}

async function appendCustomResults(map, options = {}) {
  if (!CT.enabled) return 0;

  const directions = options.directions || ["outbound", "inbound"];
  const { outbound: allOut, inbound: allIn } = collectRoutesNeedingCustom(map);
  const outbound = directions.includes("outbound") ? allOut : [];
  const inbound = directions.includes("inbound") ? allIn : [];

  if (!outbound.length && !inbound.length) {
    process.stderr.write(
      `Custom transfer: skipped (no ${directions.join("/")} routes need enrichment; ` +
        `threshold ≥${CT.trigger.maxMainResults} main results)\n`
    );
    return 0;
  }

  process.stderr.write(
    `Custom transfer (${directions.join("+")}): ${outbound.length} outbound + ${inbound.length} inbound routes need enrichment\n`
  );

  const queueBase = {
    concurrency: options.concurrency || CT.leg2Concurrency,
    cache: options.cache || null,
    useCache: CFG.search.useRouteCache,
    requestDelayMs: options.requestDelayMs ?? CFG.search.requestDelayMs,
    rateLimitPauseMs: options.rateLimitPauseMs ?? CFG.search.rateLimitPauseMs,
    rateLimitRetries: options.rateLimitRetries ?? CFG.search.rateLimitRetries,
  };

  const hubTasks = [
    ...hubLeg1Tasks(map, outbound, "outbound"),
    ...hubLeg1Tasks(map, inbound, "inbound"),
  ];
  const hubStats = await runSearchQueue(hubTasks, map, {
    ...queueBase,
    label: "Custom hub leg1",
  });
  process.stderr.write(`Custom hub leg1: ${hubStats.ran} fetched, ${hubStats.cached} cached\n`);

  const leg2Tasks = [...planLeg2Tasks(map, outbound, "outbound"), ...planLeg2Tasks(map, inbound, "inbound")];
  const leg2Stats = await runSearchQueue(leg2Tasks, map, {
    ...queueBase,
    label: "Custom leg2",
  });
  process.stderr.write(`Custom leg2: ${leg2Stats.ran} fetched, ${leg2Stats.cached} cached\n`);

  let merged = 0;
  for (const { origin, dest, date } of outbound) {
    const flights = buildCombos(map, origin, date, dest, dest);
    const entry = map.get(routeKey(`${origin}→${dest}`, date));
    if (entry) merged += addFlightsToEntry(entry, flights, { skipSignatures: existingApiSignatures(map, `${origin}→${dest}`, date) });
  }
  for (const { xjCity, gdCity, date } of inbound) {
    const flights = buildCombos(map, xjCity, date, gdCity, gdCity);
    const entry = map.get(routeKey(`${xjCity}→${gdCity}`, date));
    if (entry) merged += addFlightsToEntry(entry, flights, { skipSignatures: existingApiSignatures(map, `${xjCity}→${gdCity}`, date) });
  }

  process.stderr.write(`Custom transfer: merged ${merged} combos\n`);
  return merged;
}

module.exports = {
  appendCustomResults,
  needsCustomTransfer,
  buildCombos,
  hubsForDestination,
};
