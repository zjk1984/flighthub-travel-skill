/**
 * Unified concurrent flight search queue.
 * Modes: full (jt=1 slice + fallback jt=2), cheap (jt=2 once), direct (jt=1 slice only)
 */
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { mergeRouteEntry, routeKey } = require("./flight-store");
const { getCachedRoute, appendCacheEntries, todayIso } = require("./flight-cache");

const execFileAsync = promisify(execFile);
const ADAPTIVE_SEARCH = path.join(__dirname, "flyai-adaptive-search.sh");

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
  if (!items.length) return [];
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/**
 * @param {{ origin, dest, date, mode?: 'full'|'cheap'|'direct' }} task
 */
async function searchTask(task) {
  const { origin, dest, date, mode = "full" } = task;
  if (mode === "cheap") {
    return runAdaptiveSearch(origin, dest, date, 2);
  }
  if (mode === "direct") {
    return runAdaptiveSearch(origin, dest, date, 1);
  }
  const r1 = await runAdaptiveSearch(origin, dest, date, 1);
  if ((r1.flights || []).length > 0) return r1;
  return runAdaptiveSearch(origin, dest, date, 2);
}

/**
 * Run tasks concurrently; merge into map; optional cache write.
 */
async function runSearchQueue(tasks, map, options = {}) {
  const {
    concurrency = 4,
    cache = null,
    useCache = true,
    label = "search",
  } = options;

  const cacheWrites = [];
  const toRun = [];

  for (const task of tasks) {
    const { origin, dest, date } = task;
    const rk = routeKey(`${origin}→${dest}`, date);
    if (map.has(rk) && (map.get(rk).flights || []).length > 0) continue;

    if (useCache && cache) {
      const cached = getCachedRoute(cache, origin, dest, date);
      if (cached) {
        mergeRouteEntry(map, cached);
        continue;
      }
    }
    toRun.push(task);
  }

  await mapPool(toRun, concurrency, async (task) => {
    const { origin, dest, date } = task;
    process.stderr.write(`${label}: ${origin} → ${dest} | ${date} | ${task.mode || "full"}\n`);
    const result = await searchTask(task);
    mergeRouteEntry(map, result);
    if (useCache && cache) {
      cacheWrites.push({
        origin,
        dest,
        date,
        result,
        cachedOn: todayIso(),
      });
    }
    return result;
  });

  appendCacheEntries(cacheWrites);
  return { ran: toRun.length, cached: tasks.length - toRun.length };
}

module.exports = {
  runAdaptiveSearch,
  searchTask,
  runSearchQueue,
  mapPool,
};
