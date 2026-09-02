/**
 * Load / validate flight monitor configuration.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "config/monitor-config.json");
const DEFAULTS_PATH = path.join(ROOT, "config/monitor-defaults.json");

const CITY_LABEL = {
  伊宁: "伊犁（伊宁）",
  博乐: "博乐（赛里木湖）",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function labelCity(name) {
  return CITY_LABEL[name] || name;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadDefaults() {
  return normalizeConfig(readJson(DEFAULTS_PATH));
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaults = loadDefaults();
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2) + "\n");
    return defaults;
  }
  return normalizeConfig(readJson(CONFIG_PATH));
}

function saveConfig(config) {
  const normalized = normalizeConfig(config);
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(normalized, null, 2) + "\n");
  return normalized;
}

function normalizeSearch(raw) {
  const d = raw || {};
  return {
    concurrency: Math.max(1, Math.min(4, parseInt(d.concurrency, 10) || 1)),
    useRouteCache: d.useRouteCache !== false,
    requestDelayMs: Math.max(0, parseInt(d.requestDelayMs, 10) || 1500),
    batchDelayMs: Math.max(0, parseInt(d.batchDelayMs, 10) || 300000),
    rateLimitPauseMs: Math.max(1000, parseInt(d.rateLimitPauseMs, 10) || 60000),
    rateLimitRetries: Math.max(0, Math.min(3, parseInt(d.rateLimitRetries, 10) || 1)),
  };
}

function normalizeCustomTransfer(raw) {
  const d = raw || {};
  const trigger = d.trigger || {};
  const maxMain =
    trigger.maxMainResults != null
      ? parseInt(trigger.maxMainResults, 10)
      : parseInt(d.skipIfMainResultsAtLeast, 10);
  return {
    enabled: d.enabled !== false,
    firstLegTopN: Math.max(1, parseInt(d.firstLegTopN, 10) || 3),
    minConnectionMinutes: Math.max(30, parseInt(d.minConnectionMinutes, 10) || 90),
    maxConnectionMinutes: Math.max(120, parseInt(d.maxConnectionMinutes, 10) || 480),
    transferHubs: uniqStrings(d.transferHubs || ["西安", "兰州"]),
    preferredHubsByDest: d.preferredHubsByDest || {},
    dynamicHubsFromApi: d.dynamicHubsFromApi === true,
    leg2NextDayIfNeeded: d.leg2NextDayIfNeeded !== false,
    lateArrivalHour: Math.min(23, Math.max(0, parseInt(d.lateArrivalHour, 10) || 18)),
    skipIfMainResultsAtLeast: Math.max(0, maxMain >= 0 ? maxMain : 3),
    trigger: {
      maxMainResults: Math.max(0, maxMain >= 0 ? maxMain : 3),
    },
    leg2Concurrency: Math.max(1, Math.min(4, parseInt(d.leg2Concurrency, 10) || 1)),
    maxCombosPerRoute: Math.max(1, parseInt(d.maxCombosPerRoute, 10) || 5),
    leg2CacheEnabled: d.leg2CacheEnabled !== false,
    excludeFromMainTop3: d.excludeFromMainTop3 !== false,
  };
}

function normalizeScoring(raw) {
  const d = raw || {};
  const originScores = { ...(d.originScores || { 深圳: 100, 广州: 80 }) };
  const destinationScores = { ...(d.destinationScores || {}) };
  const apiPriceFloor = { ...(d.apiPriceFloor || { 伊宁: 750, 阿勒泰: 750 }) };
  const apiPriceFloorReturn = { ...(d.apiPriceFloorReturn || { 伊宁: 650, 阿勒泰: 650 }) };
  return { originScores, destinationScores, apiPriceFloor, apiPriceFloorReturn };
}

function normalizeConfig(raw) {
  const cfg = {
    routeLabel: String(raw.routeLabel || "航班监控").trim(),
    origins: uniqStrings(raw.origins),
    destinations: uniqStrings(raw.destinations),
    outboundDates: uniqDates(raw.outboundDates),
    returnDates: uniqDates(raw.returnDates),
    directOnlyAirports: uniqStrings(raw.directOnlyAirports || ["乌鲁木齐"]),
    search: normalizeSearch(raw.search),
    customTransfer: normalizeCustomTransfer(raw.customTransfer),
    scoring: normalizeScoring(raw.scoring),
  };

  if (!cfg.origins.length) throw new Error("origins 不能为空");
  if (!cfg.destinations.length) throw new Error("destinations 不能为空");
  if (!cfg.outboundDates.length) throw new Error("outboundDates 不能为空");
  if (!cfg.returnDates.length) throw new Error("returnDates 不能为空");

  return cfg;
}

function uniqStrings(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const v = String(item).trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function uniqDates(list) {
  const dates = uniqStrings(list);
  for (const d of dates) {
    if (!DATE_RE.test(d)) throw new Error(`无效日期格式: ${d}（需 YYYY-MM-DD）`);
  }
  return dates.sort();
}

function parseList(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return String(value).split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
}

function formatDateShort(iso) {
  const [, m, d] = iso.split("-");
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}

function formatDateRange(dates) {
  if (!dates.length) return "—";
  if (dates.length === 1) return formatDateShort(dates[0]);
  return `${formatDateShort(dates[0])} - ${formatDateShort(dates[dates.length - 1])}`;
}

function formatCoverage(destinations) {
  return destinations.map(labelCity).join("、");
}

function parseRoute(route) {
  const [origin, dest] = route.split("→");
  return { origin, dest };
}

function isOutboundRoute(route, cfg) {
  const c = cfg || loadConfig();
  const { origin, dest } = parseRoute(route);
  return c.origins.includes(origin) && c.destinations.includes(dest);
}

function remoteCity(route, cfg) {
  const c = cfg || loadConfig();
  const { origin, dest } = parseRoute(route);
  return isOutboundRoute(route, c) ? dest : origin;
}

function isDirectOnlyAirport(airport, cfg) {
  const c = cfg || loadConfig();
  return c.directOnlyAirports.includes(airport);
}

function exportBash(cfg) {
  const c = cfg || loadConfig();
  const quoteArray = (arr) => arr.map(v => `"${v.replace(/"/g, '\\"')}"`).join(" ");
  return [
    `ROUTE_LABEL=${JSON.stringify(c.routeLabel)}`,
    `OUTBOUND_DATES=(${quoteArray(c.outboundDates)})`,
    `RETURN_DATES=(${quoteArray(c.returnDates)})`,
    `ORIGINS=(${quoteArray(c.origins)})`,
    `DESTINATIONS=(${quoteArray(c.destinations)})`,
    `DIRECT_ONLY_AIRPORTS=(${quoteArray(c.directOnlyAirports)})`,
    `SEARCH_CONCURRENCY=${c.search.concurrency}`,
    `CUSTOM_TRANSFER_ENABLED=${c.customTransfer.enabled ? "true" : "false"}`,
    `CUSTOM_TRANSFER_TOPN=${c.customTransfer.firstLegTopN}`,
    `TRANSFER_HUBS=(${quoteArray(c.customTransfer.transferHubs)})`,
  ].join("\n");
}

module.exports = {
  CONFIG_PATH,
  DEFAULTS_PATH,
  loadDefaults,
  loadConfig,
  saveConfig,
  normalizeConfig,
  parseList,
  labelCity,
  formatDateShort,
  formatDateRange,
  formatCoverage,
  parseRoute,
  isOutboundRoute,
  remoteCity,
  isDirectOnlyAirport,
  exportBash,
};
