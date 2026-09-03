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
const { loadConfig, formatCoverage, isConfiguredMonitorEntry, buildOutboundTasks, buildReturnTasks } = require("./load-monitor-config");
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

const { recordSnapshots } = require("./price-history");

function buildOutboundTasksLocal() {
  return buildOutboundTasks(CFG);
}

function buildReturnTasksLocal() {
  return buildReturnTasks(CFG);
}

function queueOptions(label) {
  const cb = CFG.search.circuitBreaker || {};
  return {
    concurrency: CFG.search.concurrency,
    useCache: CFG.search.useRouteCache,
    requestDelayMs: CFG.search.requestDelayMs,
    rateLimitPauseMs: CFG.search.rateLimitPauseMs,
    rateLimitRetries: CFG.search.rateLimitRetries,
    resumeAfter451: CFG.search.resumeAfter451 !== false,
    resumeCooldownMs: CFG.search.resumeCooldownMs ?? 300000,
    resumeMaxPasses: CFG.search.resumeMaxPasses ?? 1,
    circuitBreakerEnabled: cb.enabled !== false,
    circuitBreakerThreshold: cb.threshold ?? 3,
    circuitBreakerCooldownMs: cb.cooldownMs ?? 1800000,
    label,
  };
}

function saveResults(map, resultsPath) {
  saveToFile(map, resultsPath, {
    filter: (r) => isConfiguredMonitorEntry(r, CFG),
  });
}

function runScript(script, inputPath, extraArgs = []) {
  const r = spawnSync("node", [path.join(__dirname, script), inputPath, ...extraArgs], {
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
    `Monitor (${phase}): ${CFG.routeLabel} | ${CFG.origins.join("/")} → ${formatCoverage(CFG.destinations)}` +
      (CFG.focusMode ? " [聚焦模式]" : "") +
      `\n`
  );
  if (CFG.trip?.label) {
    process.stderr.write(`  行程：${CFG.trip.label} | ${CFG.trip.partySize} 人\n`);
  }
  process.stderr.write(`  去程 ${CFG.outboundDates.join(" ")} | 返程 ${CFG.returnDates.join(" ")}\n`);
  process.stderr.write(
    `  并发 ${CFG.search.concurrency} | 请求间隔 ${CFG.search.requestDelayMs}ms | 批次间隔 ${CFG.search.batchDelayMs / 1000}s | 熔断 ${CFG.search.circuitBreaker?.threshold ?? 3}×451\n`
  );

  process.env.FLYAI_MAX_API_CALLS = String(CFG.search.maxApiCallsPerRoute);

  pruneCache();
  const cache = CFG.search.useRouteCache ? loadCache() : null;
  const map =
    phase === "return" && fs.existsSync(resultsPath)
      ? loadFromFile(resultsPath)
      : new Map();

  if (phase === "all" || phase === "outbound") {
    const outStats = await runSearchQueue(buildOutboundTasksLocal(), map, {
      ...queueOptions("Outbound"),
      cache,
    });
    process.stderr.write(
      `Outbound: ${outStats.ran} fetched, ${outStats.cached} cached, ${outStats.rateLimitHits} limits` +
        (outStats.circuitOpen ? `, circuit OPEN (${outStats.circuitSkipped} skipped)` : "") +
        `\n`
    );
    saveResults(map, resultsPath);

    if (phase === "outbound") {
      if (
        CFG.customTransfer.enabled &&
        CFG.customTransfer.outboundEnabled &&
        !outStats.circuitOpen
      ) {
        await appendCustomResults(map, {
          concurrency: CFG.customTransfer.leg2Concurrency,
          cache,
          directions: ["outbound"],
          ...queueOptions("Custom outbound"),
        });
        saveResults(map, resultsPath);
      } else if (outStats.circuitOpen && CFG.customTransfer.enabled) {
        process.stderr.write("Custom transfer: skipped (outbound circuit breaker open)\n");
      }

      const errs = countApiErrors(map);
      process.stderr.write(`Outbound phase saved: ${resultsPath} (${errs} API errors)\n`);
      fs.mkdirSync(path.dirname(latestOut), { recursive: true });
      const scopeArgs = ["--scope", "outbound"];
      fs.writeFileSync(latestOut, runScript("format-xinjiang-report.js", resultsPath, scopeArgs));
      fs.writeFileSync(rankedOut, runScript("format-ranked-report.js", resultsPath, scopeArgs));
      const briefOut = rankedOut.replace(/-ranked\.md$/, "-brief.md");
      try {
        fs.writeFileSync(briefOut, runScript("format-travel-brief.js", resultsPath));
        process.stderr.write(`Brief saved: ${briefOut}\n`);
      } catch (e) {
        process.stderr.write(`Brief generation skipped: ${e.message}\n`);
      }
      process.stderr.write(`Outbound report saved: ${latestOut}\n`);
      process.stderr.write(`Outbound ranked saved: ${rankedOut}\n`);
      if (outStats.circuitOpen) {
        process.stderr.write(
          `⚡ 风控熔断已触发，请等待 ${Math.round(CFG.search.circuitBreaker.cooldownMs / 60000)} 分钟后再跑返程\n`
        );
      } else if (errs > 0) {
        process.stderr.write(
          `建议等待 ${Math.round(CFG.search.batchDelayAfterErrorsMs / 60000)} 分钟后再跑: npm run monitor:return\n`
        );
      } else {
        process.stderr.write(`Run return phase later: npm run monitor:return\n`);
      }
      return;
    }

    const errsAfterOut = countApiErrors(map);
    const delayMs =
      outStats.circuitOpen || errsAfterOut > 0
        ? CFG.search.batchDelayAfterErrorsMs
        : CFG.search.batchDelayMs;
    if (delayMs > 0) {
      process.stderr.write(
        `Waiting ${Math.round(delayMs / 60000)} min before return` +
          (outStats.circuitOpen || errsAfterOut > 0 ? " (风控/错误延长等待)" : "") +
          `...\n`
      );
      await sleep(delayMs);
    }

    if (CFG.customTransfer.enabled && CFG.customTransfer.outboundEnabled) {
      await appendCustomResults(map, {
        concurrency: CFG.customTransfer.leg2Concurrency,
        cache,
        directions: ["outbound"],
        ...queueOptions("Custom outbound"),
      });
      saveResults(map, resultsPath);
    }
  }

  let returnCircuitOpen = false;
  if (phase === "all" || phase === "return") {
    const inStats = await runSearchQueue(buildReturnTasksLocal(), map, {
      ...queueOptions("Return"),
      cache,
    });
    returnCircuitOpen = inStats.circuitOpen;
    process.stderr.write(
      `Return: ${inStats.ran} fetched, ${inStats.cached} cached, ${inStats.rateLimitHits} limits` +
        (inStats.circuitOpen ? `, circuit OPEN (${inStats.circuitSkipped} skipped)` : "") +
        `\n`
    );
  }

  if (
    CFG.customTransfer.enabled &&
    CFG.customTransfer.inboundEnabled &&
    (phase === "all" || phase === "return") &&
    !returnCircuitOpen
  ) {
    await appendCustomResults(map, {
      concurrency: CFG.customTransfer.leg2Concurrency,
      cache,
      directions: ["inbound"],
      ...queueOptions("Custom inbound"),
    });
  } else if (returnCircuitOpen && CFG.customTransfer.enabled) {
    process.stderr.write("Custom transfer: skipped (return phase circuit breaker open)\n");
  }

  saveResults(map, resultsPath);
  recordSnapshots(compactMap(map).filter((r) => isConfiguredMonitorEntry(r, CFG)));
  const apiErrors = countApiErrors(map);
  if (apiErrors > 0) {
    process.stderr.write(`Warning: ${apiErrors} routes have apiError (see JSONL / report)\n`);
  }

  fs.mkdirSync(path.dirname(latestOut), { recursive: true });
  const returnOnly = !!(CFG.trip?.skipOutboundMonitor || CFG.trip?.bookedOutbound);
  const scopeArgs = returnOnly && phase === "return" ? ["--scope", "return"] : [];
  fs.writeFileSync(latestOut, runScript("format-xinjiang-report.js", resultsPath, scopeArgs));
  fs.writeFileSync(rankedOut, runScript("format-ranked-report.js", resultsPath, scopeArgs));
  const briefOut = rankedOut.replace(/-ranked\.md$/, "-brief.md").replace(/outbound-ranked\.md$/, "outbound-brief.md");
  const planOut = path.join(ROOT, "reports/xinjiang-travel-plan.md");
  try {
    fs.writeFileSync(briefOut, runScript("format-travel-brief.js", resultsPath));
    process.stderr.write(`Brief saved: ${briefOut}\n`);
  } catch (e) {
    process.stderr.write(`Brief generation skipped: ${e.message}\n`);
  }
  try {
    runScript("format-travel-plan.js", resultsPath, ["--out", planOut]);
    process.stderr.write(`Travel plan saved: ${planOut}\n`);
    const cardsOut = path.join(ROOT, "reports/xinjiang-travel-cards.md");
    runScript("format-travel-cards.js", resultsPath, ["--out", cardsOut]);
    process.stderr.write(`Travel cards saved: ${cardsOut}\n`);
    const cardsPlanb = path.join(ROOT, "reports/xinjiang-travel-cards-planb.md");
    try {
      runScript("format-travel-cards.js", resultsPath, ["--variant", "planb", "--out", cardsPlanb]);
      process.stderr.write(`Travel cards saved: ${cardsPlanb}\n`);
    } catch (e) {
      process.stderr.write(`Plan B cards skipped: ${e.message}\n`);
    }
  } catch (e) {
    process.stderr.write(`Travel plan skipped: ${e.message}\n`);
  }
  process.stderr.write(`Report saved: ${latestOut}\n`);
  process.stderr.write(`Ranked report saved: ${rankedOut}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
