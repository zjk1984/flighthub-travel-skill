/**
 * Unified concurrent flight search queue.
 * Modes: full (jt=1 slice + fallback jt=2), cheap (jt=2 once), direct (jt=1 slice only)
 */
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { mergeRouteEntry, routeKey } = require("./flight-store");
const {
  getCachedRoute,
  appendCacheEntries,
  todayIso,
  isResultCacheable,
  isRiskControlError,
  isRetryableError,
} = require("./flight-cache");

const execFileAsync = promisify(execFile);
const ADAPTIVE_SEARCH = path.join(__dirname, "flyai-adaptive-search.sh");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    return {
      route: `${origin}→${dest}`,
      date,
      apiCount: 0,
      dedup: "error",
      flights: [],
      apiError: "exec_error",
    };
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
  if (r1.apiError || (r1.flights || []).length > 0) return r1;
  return runAdaptiveSearch(origin, dest, date, 2);
}

function skippedResult(origin, dest, date, reason) {
  return {
    route: `${origin}→${dest}`,
    date,
    apiCount: 0,
    dedup: "skipped",
    flights: [],
    apiError: reason,
  };
}

/**
 * Run tasks concurrently; merge into map; optional cache write.
 * Failed 451 routes are queued for a cooldown resume pass when enabled.
 */
async function runOneTask(task, map, options, state) {
  const {
    label = "search",
    requestDelayMs = 3000,
    rateLimitPauseMs = 60000,
    rateLimitRetries = 1,
    circuitBreakerEnabled = true,
    circuitBreakerThreshold = 3,
    useCache = true,
    cache = null,
  } = options;

  const { origin, dest, date } = task;

  if (state.circuitOpen) {
    state.circuitSkipped++;
    const skipped = skippedResult(origin, dest, date, "451:circuit_open_skipped");
    state.failed451Tasks.push({ ...task, reason: skipped.apiError });
    mergeRouteEntry(map, skipped);
    return skipped;
  }

  process.stderr.write(`${label}: ${origin} → ${dest} | ${date} | ${task.mode || "full"}\n`);

  let result = await searchTask(task);

  if (isRiskControlError(result)) {
    state.rateLimitHits++;
    state.consecutiveRiskControl++;
    process.stderr.write(
      `${label}: risk control ${result.apiError} (${state.consecutiveRiskControl}/${circuitBreakerThreshold})\n`
    );
    state.failed451Tasks.push({ ...task, reason: result.apiError });
    if (
      circuitBreakerEnabled &&
      state.consecutiveRiskControl >= circuitBreakerThreshold &&
      !state.circuitOpen
    ) {
      state.circuitOpen = true;
      process.stderr.write(
        `${label}: ⚡ circuit breaker OPEN — remaining tasks deferred to resume queue.\n`
      );
    }
  } else if (isRetryableError(result)) {
    let retries = 0;
    while (isRetryableError(result) && retries < rateLimitRetries) {
      state.rateLimitHits++;
      process.stderr.write(
        `${label}: quota limit (${result.apiError}) — pausing ${rateLimitPauseMs / 1000}s before retry\n`
      );
      await sleep(rateLimitPauseMs);
      result = await searchTask(task);
      retries++;
    }
    if (!result.apiError) {
      state.consecutiveRiskControl = 0;
      state.failed451Tasks = state.failed451Tasks.filter(
        (t) => !(t.origin === origin && t.dest === dest && t.date === date)
      );
    } else if (isRiskControlError(result)) {
      state.failed451Tasks.push({ ...task, reason: result.apiError });
    }
  } else if (!result.apiError) {
    state.consecutiveRiskControl = 0;
    state.failed451Tasks = state.failed451Tasks.filter(
      (t) => !(t.origin === origin && t.dest === dest && t.date === date)
    );
  }

  if (result.apiError && !result.apiError.includes("circuit_open_skipped")) {
    process.stderr.write(`${label}: ${origin} → ${dest} | ${date} failed: ${result.apiError}\n`);
  }

  mergeRouteEntry(map, result);

  if (useCache && cache && isResultCacheable(result)) {
    state.cacheWrites.push({
      origin,
      dest,
      date,
      result,
      cachedOn: todayIso(),
    });
  }

  if (requestDelayMs > 0) await sleep(requestDelayMs);
  return result;
}

async function runSearchQueue(tasks, map, options = {}) {
  const {
    concurrency = 1,
    cache = null,
    useCache = true,
    label = "search",
    requestDelayMs = 3000,
    resumeAfter451 = true,
    resumeCooldownMs = 300000,
    resumeMaxPasses = 1,
  } = options;

  const cacheWrites = [];
  const toRun = [];

  for (const task of tasks) {
    const { origin, dest, date } = task;
    const existing = map.get(routeKey(`${origin}→${dest}`, date));
    if (existing && (existing.flights || []).length > 0) continue;

    if (useCache && cache) {
      const cached = getCachedRoute(cache, origin, dest, date);
      if (cached) {
        mergeRouteEntry(map, cached);
        continue;
      }
    }
    toRun.push(task);
  }

  const state = {
    rateLimitHits: 0,
    circuitSkipped: 0,
    circuitOpen: false,
    consecutiveRiskControl: 0,
    failed451Tasks: [],
    cacheWrites,
  };

  await mapPool(toRun, concurrency, async (task) => runOneTask(task, map, options, state));

  let resumePasses = 0;
  while (
    resumeAfter451 &&
    resumeMaxPasses > 0 &&
    resumePasses < resumeMaxPasses &&
    state.failed451Tasks.length > 0
  ) {
    const retryTasks = [...state.failed451Tasks];
    state.failed451Tasks = [];
    state.circuitOpen = false;
    state.consecutiveRiskControl = 0;
    resumePasses++;
    process.stderr.write(
      `${label}: resume pass ${resumePasses}/${resumeMaxPasses} — ${retryTasks.length} routes after ${Math.round(resumeCooldownMs / 1000)}s cooldown\n`
    );
    await sleep(resumeCooldownMs);
    await mapPool(retryTasks, concurrency, async (task) => runOneTask(task, map, options, state));
  }

  appendCacheEntries(state.cacheWrites);
  persistFailedTasks(state.failed451Tasks);

  return {
    ran: toRun.length,
    cached: tasks.length - toRun.length,
    rateLimitHits: state.rateLimitHits,
    circuitSkipped: state.circuitSkipped,
    circuitOpen: state.circuitOpen,
    resumePasses,
    failedRemaining: state.failed451Tasks.length,
  };
}

function persistFailedTasks(failedTasks) {
  if (!failedTasks.length) return;
  const fs = require("fs");
  const outPath = path.join(__dirname, "..", "reports/failed-tasks.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify({ at: new Date().toISOString(), tasks: failedTasks }, null, 2) + "\n"
  );
  process.stderr.write(`Failed tasks saved: ${outPath} (${failedTasks.length})\n`);
}

module.exports = {
  runAdaptiveSearch,
  searchTask,
  runSearchQueue,
  mapPool,
  sleep,
  isRiskControlError,
  isRetryableError,
};
