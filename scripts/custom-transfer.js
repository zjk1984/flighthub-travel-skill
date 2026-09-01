#!/usr/bin/env node
/**
 * CLI wrapper: enrich existing JSONL with custom transfer itineraries.
 * Usage: node scripts/custom-transfer.js <results.jsonl>
 */
const fs = require("fs");
const { loadConfig } = require("./load-monitor-config");
const { loadFromFile, saveToFile, compactMap } = require("./flight-store");
const { loadCache, pruneCache } = require("./flight-cache");
const { appendCustomResults } = require("./custom-transfer-lib");

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node scripts/custom-transfer.js <results.jsonl>");
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
