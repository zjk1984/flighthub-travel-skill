#!/usr/bin/env node
/**
 * Unified monitor orchestrator: main search → custom transfer → reports
 *
 * Usage:
 *   node monitor-run.js [--phase all|outbound|return] [results.jsonl] [latest.md] [ranked.md]
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { loadConfig, formatCoverage } = require("./load-monitor-config");
const { compactMap, saveToFile, loadFromFile } = require("./flight-store");
const { loadCache, pruneCache } = require("./flight-cache");
const { runSearchQueue, sleep } = require("./search-queue");
const { appendCustomResults } = require("./custom-transfer-lib");

const ROOT = path.join(__dirname, "..");
const CFG = loadConfig();

function parseArgs(argv) {
  const positional = [];
  let phase = "all";
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--phase" && argv[i + 1]) {
      phase = argv[++i];
      continue;
    }
    positional.push(argv[i]);
  }
  if (!["all", "outbound", "return"].includes(phase)) {
    throw new Error(`Invalid --phase ${phase} (use all|outbound|return)`);
  }
  return {
    phase,
    resultsPath: positional[0] || path.join(ROOT, "reports/xinjiang-results.jsonl"),
    latestOut: positional[1] || path.join(ROOT, "reports/xinjiang-flights-latest.md"),
    rankedOut: positional[2] || path.join(ROOT, "reports/xinjiang-flights-ranked.md"),
  };
}

function buildOutboundTasks() {
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
  return tasks;
}

function buildReturnTasks() {
  const tasks = [];
  const directOnly = new Set(CFG.directOnlyAirports);
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

function queueOptions(label) {
  return {
    concurrency: CFG.search.concurrency,
    useCache: CFG.search.useRouteCache,
    requestDelayMs: CFG.search.requestDelayMs,
    rateLimitPauseMs: CFG.search.rateLimitPauseMs,
    rateLimitRetries: CFG.search.rateLimitRetries,
    label,
  };
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

function countApiErrors(map) {
  return compactMap(map).filter((r) => r.apiError).length;
}

async function main() {
  const { phase, resultsPath, latestOut, rankedOut } = parseArgs(process.argv);

  process.stderr.write(
    `Monitor (${phase}): ${CFG.routeLabel} | ${CFG.origins.join("/")} → ${formatCoverage(CFG.destinations)}\n`
  );
  process.stderr.write(`  去程 ${CFG.outboundDates.join(" ")} | 返程 ${CFG.returnDates.join(" ")}\n`);
  process.stderr.write(
    `  并发 ${CFG.search.concurrency} | 请求间隔 ${CFG.search.requestDelayMs}ms | 批次间隔 ${CFG.search.batchDelayMs / 1000}s\n`
  );

  pruneCache();
  const cache = CFG.search.useRouteCache ? loadCache() : null;
  const map =
    phase === "return" && fs.existsSync(resultsPath)
      ? loadFromFile(resultsPath)
      : new Map();

  if (phase === "all" || phase === "outbound") {
    const outStats = await runSearchQueue(buildOutboundTasks(), map, {
      ...queueOptions("Outbound"),
      cache,
    });
    process.stderr.write(
      `Outbound: ${outStats.ran} fetched, ${outStats.cached} cached, ${outStats.rateLimitHits} rate-limit pauses\n`
    );
    saveToFile(map, resultsPath);

    if (phase === "outbound") {
      process.stderr.write(`Outbound phase saved: ${resultsPath} (${countApiErrors(map)} API errors)\n`);
      process.stderr.write(`Run return phase later: npm run monitor:return\n`);
      return;
    }

    if (CFG.search.batchDelayMs > 0) {
      process.stderr.write(
        `Waiting ${CFG.search.batchDelayMs / 1000}s before return search (avoid API rate limit)...\n`
      );
      await sleep(CFG.search.batchDelayMs);
    }
  }

  if (phase === "all" || phase === "return") {
    const inStats = await runSearchQueue(buildReturnTasks(), map, {
      ...queueOptions("Return"),
      cache,
    });
    process.stderr.write(
      `Return: ${inStats.ran} fetched, ${inStats.cached} cached, ${inStats.rateLimitHits} rate-limit pauses\n`
    );
  }

  if (CFG.customTransfer.enabled && (phase === "all" || phase === "return")) {
    await appendCustomResults(map, {
      concurrency: CFG.customTransfer.leg2Concurrency,
      cache,
      ...queueOptions("Custom"),
    });
  }

  saveToFile(map, resultsPath);
  const apiErrors = countApiErrors(map);
  if (apiErrors > 0) {
    process.stderr.write(`Warning: ${apiErrors} routes have apiError (see JSONL / report)\n`);
  }

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
