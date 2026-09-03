/**
 * Daily lowest-price snapshots for focus routes.
 */
const fs = require("fs");
const path = require("path");
const { parsePrice } = require("./flight-store");

const DEFAULT_HISTORY_PATH = path.join(__dirname, "..", "reports/price-history.jsonl");

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function loadHistory(historyPath = DEFAULT_HISTORY_PATH) {
  const map = new Map();
  if (!fs.existsSync(historyPath)) return map;
  for (const line of fs.readFileSync(historyPath, "utf8").split("\n").filter(Boolean)) {
    try {
      const row = JSON.parse(line);
      if (!row.key) continue;
      map.set(row.key, row);
    } catch (_) {
      /* skip */
    }
  }
  return map;
}

function routeDateKey(route, date) {
  return `${route}|${date}`;
}

function lowestPriceFromFlights(flights) {
  const prices = (flights || [])
    .map((f) => parsePrice(f.price))
    .filter((p) => p > 0);
  if (!prices.length) return null;
  return Math.min(...prices);
}

function recordSnapshots(entries, historyPath = DEFAULT_HISTORY_PATH) {
  const today = todayIso();
  const history = loadHistory(historyPath);
  const written = [];

  for (const entry of entries) {
    const low = lowestPriceFromFlights(entry.flights);
    if (low == null) continue;
    const key = routeDateKey(entry.route, entry.date);
    const prev = history.get(key);
    const row = {
      key,
      route: entry.route,
      date: entry.date,
      recordedOn: today,
      lowestPrice: low,
      prevLowest: null,
      prevRecordedOn: null,
    };
    if (prev) {
      if (prev.recordedOn === today) {
        row.prevLowest = prev.lowestPrice;
        row.prevRecordedOn = prev.recordedOn;
        row.lowestPrice = Math.min(prev.lowestPrice, low);
      } else {
        row.prevLowest = prev.lowestPrice;
        row.prevRecordedOn = prev.recordedOn;
      }
    }
    history.set(key, row);
    written.push(row);
  }

  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  const lines = [...history.values()].map((r) => JSON.stringify(r)).join("\n") + "\n";
  fs.writeFileSync(historyPath, lines);
  return written;
}

function formatDelta(row) {
  if (row.prevLowest == null || row.prevRecordedOn === row.recordedOn) return null;
  const delta = row.lowestPrice - row.prevLowest;
  if (delta === 0) return `较 ${row.prevRecordedOn} 持平 ¥${row.lowestPrice.toFixed(0)}`;
  const sign = delta > 0 ? "+" : "";
  return `较 ${row.prevRecordedOn} ${sign}¥${delta.toFixed(0)}（${row.prevLowest.toFixed(0)}→${row.lowestPrice.toFixed(0)}）`;
}

function getDeltaForRoute(route, date, historyPath = DEFAULT_HISTORY_PATH) {
  const history = loadHistory(historyPath);
  const row = history.get(routeDateKey(route, date));
  if (!row) return null;
  return formatDelta(row);
}

module.exports = {
  DEFAULT_HISTORY_PATH,
  loadHistory,
  recordSnapshots,
  formatDelta,
  getDeltaForRoute,
  routeDateKey,
  lowestPriceFromFlights,
};
