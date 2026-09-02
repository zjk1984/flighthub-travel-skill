#!/usr/bin/env node
/**
 * CLI wrapper: enrich existing JSONL with custom transfer itineraries.
 * Usage: node scripts/custom-transfer.js [--direction outbound|inbound|both] <results.jsonl>
 */
const fs = require("fs");
const { loadConfig } = require("./load-monitor-config");
const { loadFromFile, saveToFile, compactMap } = require("./flight-store");
const { loadCache, pruneCache } = require("./flight-cache");
const { appendCustomResults } = require("./custom-transfer-lib");

function parseArgs(argv) {
  let direction = "both";
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--direction" && argv[i + 1]) {
      direction = argv[++i];
      continue;
    }
    positional.push(argv[i]);
  }
  const dirs =
    direction === "both"
      ? ["outbound", "inbound"]
      : direction === "outbound" || direction === "inbound"
        ? [direction]
        : null;
  if (!dirs) {
    console.error("Invalid --direction (use outbound|inbound|both)");
    process.exit(1);
  }
  return { filePath: positional[0], directions: dirs };
}

async function main() {
  const { filePath, directions } = parseArgs(process.argv);
  if (!filePath) {
    console.error("Usage: node scripts/custom-transfer.js [--direction outbound|inbound|both] <results.jsonl>");
    process.exit(1);
  }
  const CFG = loadConfig();
  if (!CFG.customTransfer.enabled) {
    process.stderr.write("Custom transfer disabled\n");
    return;
  }

  pruneCache();
  const cache = CFG.search.useRouteCache ? loadCache() : null;
  const map = loadFromFile(filePath);
  await appendCustomResults(map, {
    concurrency: CFG.customTransfer.leg2Concurrency,
    cache,
    directions,
    requestDelayMs: CFG.search.requestDelayMs,
    rateLimitPauseMs: CFG.search.rateLimitPauseMs,
    rateLimitRetries: CFG.search.rateLimitRetries,
    circuitBreakerEnabled: CFG.search.circuitBreaker?.enabled,
    circuitBreakerThreshold: CFG.search.circuitBreaker?.threshold,
    circuitBreakerCooldownMs: CFG.search.circuitBreaker?.cooldownMs,
  });
  saveToFile(map, filePath);
  const customCount = compactMap(map).reduce(
    (n, r) => n + (r.flights || []).filter((f) => f.customTransfer).length,
    0
  );
  process.stderr.write(`Custom transfer total: ${customCount}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
