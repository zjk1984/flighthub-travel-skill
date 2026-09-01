#!/usr/bin/env node
/**
 * Manage flight monitor configuration (dates, origins, destinations).
 *
 * Usage:
 *   node monitor-config.js show
 *   node monitor-config.js reset [--origins|--destinations|--outbound-dates|--return-dates|--all]
 *   node monitor-config.js set --origins 深圳,广州 --destinations 乌鲁木齐,伊宁 \
 *        --outbound-dates 2026-10-01,2026-10-02 --return-dates 2026-10-08,2026-10-09
 *   node monitor-config.js export-bash
 */
const {
  loadDefaults,
  loadConfig,
  saveConfig,
  parseList,
  formatDateRange,
  formatCoverage,
  exportBash,
} = require("./load-monitor-config");

function usage() {
  console.log(`用法:
  node scripts/monitor-config.js show [--json]
  node scripts/monitor-config.js reset [--all | --origins | --destinations | --outbound-dates | --return-dates]
  node scripts/monitor-config.js set [选项]
  node scripts/monitor-config.js export-bash

set 选项:
  --route-label TEXT
  --origins 深圳,广州
  --destinations 乌鲁木齐,伊宁,阿勒泰
  --outbound-dates 2026-09-28,2026-09-29
  --return-dates 2026-10-06,2026-10-07
  --direct-only-airports 乌鲁木齐

示例:
  npm run monitor:reset
  npm run monitor:set -- --outbound-dates 2026-11-01,2026-11-02 --return-dates 2026-11-08
  npm run monitor:set -- --origins 深圳 --destinations 乌鲁木齐,伊宁`);
}

function parseArgs(argv) {
  const args = { cmd: argv[2] };
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    const isReset = args.cmd === "reset";

    if (a === "--json") args.json = true;
    else if (a === "--all") args.all = true;
    else if (a === "--origins") {
      if (isReset) args.resetOrigins = true;
      else args.origins = parseList(argv[++i]);
    } else if (a === "--destinations") {
      if (isReset) args.resetDestinations = true;
      else args.destinations = parseList(argv[++i]);
    } else if (a === "--outbound-dates") {
      if (isReset) args.resetOutboundDates = true;
      else args.outboundDates = parseList(argv[++i]);
    } else if (a === "--return-dates") {
      if (isReset) args.resetReturnDates = true;
      else args.returnDates = parseList(argv[++i]);
    } else if (a === "--route-label") {
      if (isReset) args.resetRouteLabel = true;
      else args.routeLabel = argv[++i];
    } else if (a === "--direct-only-airports") {
      if (isReset) args.resetDirectOnlyAirports = true;
      else args.directOnlyAirports = parseList(argv[++i]);
    }
  }
  return args;
}

function showConfig(cfg, asJson) {
  if (asJson) {
    console.log(JSON.stringify(cfg, null, 2));
    return;
  }
  console.log("当前监控配置");
  console.log("────────────────");
  console.log(`航线标签     ${cfg.routeLabel}`);
  console.log(`出发地       ${cfg.origins.join("、")}`);
  console.log(`目的地       ${formatCoverage(cfg.destinations)}`);
  console.log(`去程日期     ${cfg.outboundDates.join(", ")}  (${formatDateRange(cfg.outboundDates)})`);
  console.log(`返程日期     ${cfg.returnDates.join(", ")}  (${formatDateRange(cfg.returnDates)})`);
  console.log(`仅查直达机场 ${cfg.directOnlyAirports.join("、")}`);
  if (cfg.customTransfer?.enabled) {
    const ct = cfg.customTransfer;
    console.log(
      `自定义中转   开启 | Top${ct.firstLegTopN} | 枢纽 ${ct.transferHubs.join("、")} | ` +
        `主查询≥${ct.skipIfMainResultsAtLeast}条跳过 | leg2并发${ct.leg2Concurrency}`
    );
  } else {
    console.log("自定义中转   关闭");
  }
}

function cmdReset(args) {
  const defaults = loadDefaults();
  const current = loadConfig();
  const fields = {
    routeLabel: args.all || args.resetRouteLabel,
    origins: args.all || args.resetOrigins,
    destinations: args.all || args.resetDestinations,
    outboundDates: args.all || args.resetOutboundDates,
    returnDates: args.all || args.resetReturnDates,
    directOnlyAirports: args.all || args.resetDirectOnlyAirports,
  };

  const anyField = Object.values(fields).some(Boolean);
  if (!anyField) {
    saveConfig(defaults);
    console.log("已重置全部配置为默认值");
    showConfig(loadConfig());
    return;
  }

  const next = { ...current };
  if (fields.routeLabel) next.routeLabel = defaults.routeLabel;
  if (fields.origins) next.origins = [...defaults.origins];
  if (fields.destinations) next.destinations = [...defaults.destinations];
  if (fields.outboundDates) next.outboundDates = [...defaults.outboundDates];
  if (fields.returnDates) next.returnDates = [...defaults.returnDates];
  if (fields.directOnlyAirports) next.directOnlyAirports = [...defaults.directOnlyAirports];

  saveConfig(next);
  console.log("已重置指定项为默认值");
  showConfig(loadConfig());
}

function cmdSet(args) {
  const current = loadConfig();
  const next = { ...current };

  if (args.routeLabel != null) next.routeLabel = args.routeLabel;
  if (args.origins != null) next.origins = args.origins;
  if (args.destinations != null) next.destinations = args.destinations;
  if (args.outboundDates != null) next.outboundDates = args.outboundDates;
  if (args.returnDates != null) next.returnDates = args.returnDates;
  if (args.directOnlyAirports != null) next.directOnlyAirports = args.directOnlyAirports;

  const changed = ["routeLabel", "origins", "destinations", "outboundDates", "returnDates", "directOnlyAirports"]
    .some(k => args[k] != null);
  if (!changed) {
    console.error("未指定任何 set 参数");
    usage();
    process.exit(1);
  }

  saveConfig(next);
  console.log("配置已更新");
  showConfig(loadConfig());
}

function main() {
  const args = parseArgs(process.argv);
  switch (args.cmd) {
    case "show":
      showConfig(loadConfig(), args.json);
      break;
    case "reset":
      cmdReset(args);
      break;
    case "set":
      cmdSet(args);
      break;
    case "export-bash":
      console.log(exportBash(loadConfig()));
      break;
    default:
      usage();
      process.exit(args.cmd ? 1 : 0);
  }
}

main();
