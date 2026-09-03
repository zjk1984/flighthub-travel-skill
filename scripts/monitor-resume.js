#!/usr/bin/env node
/**
 * Retry routes listed in reports/failed-tasks.json after cooldown.
 */
const fs = require("fs");
const path = require("path");
const { loadConfig, isConfiguredMonitorEntry } = require("./load-monitor-config");
const { loadFromFile, saveToFile, compactMap } = require("./flight-store");
const { loadCache, pruneCache } = require("./flight-cache");
const { runSearchQueue } = require("./search-queue");

const ROOT = path.join(__dirname, "..");
const FAILED_PATH = path.join(ROOT, "reports/failed-tasks.json");
const RESULTS_PATH = path.join(ROOT, "reports/xinjiang-results.jsonl");

async function main() {
  if (!fs.existsSync(FAILED_PATH)) {
    console.error("No failed-tasks file — nothing to resume");
    process.exit(0);
  }
  const { tasks } = JSON.parse(fs.readFileSync(FAILED_PATH, "utf8"));
  if (!tasks?.length) {
    console.error("Failed task list is empty");
    process.exit(0);
  }

  const CFG = loadConfig();
  pruneCache();
  const cache = CFG.search.useRouteCache ? loadCache() : null;
  const map = fs.existsSync(RESULTS_PATH) ? loadFromFile(RESULTS_PATH) : new Map();

  const cb = CFG.search.circuitBreaker || {};
  const stats = await runSearchQueue(tasks, map, {
    concurrency: CFG.search.concurrency,
    useCache: CFG.search.useRouteCache,
    cache,
    label: "Resume",
    requestDelayMs: CFG.search.requestDelayMs,
    rateLimitPauseMs: CFG.search.rateLimitPauseMs,
    rateLimitRetries: CFG.search.rateLimitRetries,
    resumeAfter451: false,
    circuitBreakerEnabled: cb.enabled !== false,
    circuitBreakerThreshold: cb.threshold ?? 3,
  });

  saveToFile(map, RESULTS_PATH, {
    filter: (r) => isConfiguredMonitorEntry(r, CFG),
  });

  if (stats.failedRemaining === 0) {
    fs.unlinkSync(FAILED_PATH);
    process.stderr.write("All failed routes recovered — removed failed-tasks.json\n");
  }

  process.stderr.write(
    `Resume done: ran ${stats.ran}, failed remaining ${stats.failedRemaining}\n`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
