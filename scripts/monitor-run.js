#!/usr/bin/env node
/**
 * Unified monitor orchestrator: main search → custom transfer → reports
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { loadConfig, formatCoverage } = require("./load-monitor-config");
const { compactMap, saveToFile } = require("./flight-store");
const { loadCache, pruneCache } = require("./flight-cache");
const { runSearchQueue } = require("./search-queue");
const { appendCustomResults } = require("./custom-transfer-lib");

const ROOT = path.join(__dirname, "..");
const CFG = loadConfig();

function buildMainSearchTasks() {
  const tasks = [];
  const directOnly = new Set(CFG.directOnlyAirports);

  for (const date of CFG.outboundDates) {
    for (const origin of CFG.origins) {
      for (const dest of CFG.destinations) {
        tasks.push({
          origin,
          dest,
          date,
          mode: directOnly.has(dest) ? "direct" : "full",
        });
      }
    }
  }
  for (const date of CFG.returnDates) {
    for (const dest of CFG.destinations) {
      for (const origin of CFG.origins) {
        tasks.push({
          origin: dest,
          dest: origin,
          date,
          mode: directOnly.has(dest) ? "direct" : "full",
        });
      }
    }
  }
  return tasks;
}

function runScript(script, inputPath) {
  const r = spawnSync("node", [path.join(__dirname, script), inputPath], {
    encoding: "utf8",
    cwd: ROOT,
    env: process.env,
  });
  if (r.status !== 0) {
    process.stderr.write(r.stderr || "");
    throw new Error(`${script} exited ${r.status}`);
  }
  return r.stdout;
}

async function main() {
  const resultsPath = process.argv[2] || path.join(ROOT, "reports/xinjiang-results.jsonl");
  const latestOut = process.argv[3] || path.join(ROOT, "reports/xinjiang-flights-latest.md");
  const rankedOut = process.argv[4] || path.join(ROOT, "reports/xinjiang-flights-ranked.md");

  process.stderr.write(
    `Monitor: ${CFG.routeLabel} | ${CFG.origins.join("/")} → ${formatCoverage(CFG.destinations)}\n`
  );
  process.stderr.write(`  去程 ${CFG.outboundDates.join(" ")} | 返程 ${CFG.returnDates.join(" ")}\n`);
  process.stderr.write(`  搜索并发 ${CFG.search.concurrency}\n`);

  pruneCache();
  const cache = CFG.search.useRouteCache ? loadCache() : null;
  const map = new Map();

  const mainStats = await runSearchQueue(buildMainSearchTasks(), map, {
    concurrency: CFG.search.concurrency,
    cache,
    useCache: CFG.search.useRouteCache,
    label: "Main search",
  });
  process.stderr.write(`Main search: ${mainStats.ran} API calls, ${mainStats.cached} cache hits\n`);

  if (CFG.customTransfer.enabled) {
    await appendCustomResults(map, {
      concurrency: CFG.customTransfer.leg2Concurrency,
      cache,
    });
  }

  saveToFile(map, resultsPath);

  fs.mkdirSync(path.dirname(latestOut), { recursive: true });
  fs.writeFileSync(latestOut, runScript("format-xinjiang-report.js", resultsPath));
  fs.writeFileSync(rankedOut, runScript("format-ranked-report.js", resultsPath));
  process.stderr.write(`Report saved: ${latestOut}\n`);
  process.stderr.write(`Ranked report saved: ${rankedOut}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
