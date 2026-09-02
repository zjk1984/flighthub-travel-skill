/**
 * Unified route cache with date-based expiry (same dep-date valid for the day).
 */
const fs = require("fs");
const path = require("path");
const { routeKey } = require("./flight-store");

const DEFAULT_CACHE_PATH = path.join(__dirname, "..", "reports/flight-route-cache.jsonl");

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function cacheEntryKey(origin, dest, date) {
  return `${origin}|${dest}|${date}`;
}

function isRateLimitError(result) {
  const err = String(result?.apiError || "");
  return /429|451|risk_control|trial_limit/i.test(err);
}

/** Only cache successful API responses (never rate-limit / error responses). */
function isResultCacheable(result) {
  if (!result) return false;
  if (result.apiError) return false;
  return true;
}

function loadCache(cachePath = DEFAULT_CACHE_PATH) {
  const map = new Map();
  if (!fs.existsSync(cachePath)) return map;
  const today = todayIso();
  try {
    for (const line of fs.readFileSync(cachePath, "utf8").split("\n").filter(Boolean)) {
      const row = JSON.parse(line);
      if (row.cachedOn && row.cachedOn < today) continue;
      if (!isResultCacheable(row.result)) continue;
      map.set(cacheEntryKey(row.origin, row.dest, row.date), row);
    }
  } catch (_) {
    /* ignore */
  }
  return map;
}

function getCachedRoute(cache, origin, dest, date) {
  const row = cache.get(cacheEntryKey(origin, dest, date));
  if (!row?.result || !isResultCacheable(row.result)) return null;
  return row.result;
}

function appendCacheEntries(entries, cachePath = DEFAULT_CACHE_PATH) {
  const cacheable = entries.filter((e) => isResultCacheable(e.result));
  if (!cacheable.length) return;
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const lines = cacheable.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.appendFileSync(cachePath, lines);
}

function pruneCache(cachePath = DEFAULT_CACHE_PATH) {
  if (!fs.existsSync(cachePath)) return;
  const today = todayIso();
  const kept = [];
  for (const line of fs.readFileSync(cachePath, "utf8").split("\n").filter(Boolean)) {
    try {
      const row = JSON.parse(line);
      if (row.cachedOn >= today && isResultCacheable(row.result)) kept.push(line);
    } catch (_) {
      /* drop */
    }
  }
  fs.writeFileSync(cachePath, kept.length ? kept.join("\n") + "\n" : "");
}

module.exports = {
  DEFAULT_CACHE_PATH,
  loadCache,
  getCachedRoute,
  appendCacheEntries,
  pruneCache,
  cacheEntryKey,
  todayIso,
  isResultCacheable,
  isRateLimitError,
};
