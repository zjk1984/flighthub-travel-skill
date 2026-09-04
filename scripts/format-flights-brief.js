#!/usr/bin/env node
/**
 * Lightweight return-flight brief (alerts + compare + price deltas).
 * Full TOP3 scoring lives in format-ranked-report.js.
 *
 * Usage: node format-flights-brief.js [results.jsonl]
 */
const fs = require("fs");
const path = require("path");
const { formatShanghaiTime } = require("./format-time");
const { parseJsonl, buildRouteMap, compactMap } = require("./flight-store");
const {
  loadConfig,
  formatDateShort,
  isOutboundRoute,
  isConfiguredMonitorEntry,
} = require("./load-monitor-config");
const {
  getProfile,
  pickScenario,
  isSameDayArrival,
} = require("./scoring-profiles");
const { getDeltaForRoute, lowestPriceFromFlights } = require("./price-history");
const {
  renderInventoryAlert,
  renderTargetPriceAlert,
  renderPhase2Notice,
} = require("./return-flight-prefs");

const ROOT = path.join(__dirname, "..");
const CFG = loadConfig();
const TRIP = CFG.trip || {};
const PARTY = TRIP.partySize || 1;
const PROFILE = getProfile(TRIP.scoringProfile || CFG.scoring?.profile || "default");

function parseArgs(argv) {
  let inputPath = path.join(ROOT, "reports/xinjiang-results.jsonl");
  for (let i = 2; i < argv.length; i++) {
    if (!argv[i].startsWith("-")) inputPath = argv[i];
  }
  return { inputPath };
}

function flattenFlights(results) {
  const flights = [];
  for (const r of results) {
    for (const f of r.flights || []) {
      flights.push({
        ...f,
        route: r.route,
        date: r.date,
        priceNum: parseFloat(String(f.price).replace(/[^0-9.]/g, "")) || 0,
        transfers: String(f.flightNo || "").split("/").length - 1,
      });
    }
  }
  return flights;
}

function fmtTime(dt) {
  if (!dt) return "—";
  return `${dt.slice(0, 10).slice(5)} ${dt.slice(11, 16)}`;
}

function fmtParty(price) {
  return `¥${price.toFixed(0)}（${PARTY}人 ¥${(price * PARTY).toFixed(0)}）`;
}

function renderFlightRow(label, f) {
  if (!f) return `| ${label} | — | — | — | — |\n`;
  const sameDay = isSameDayArrival(f) ? "是" : "否";
  const book = f.jumpUrl ? `[预订](${f.jumpUrl})` : "—";
  return `| ${label} | **${f.flightNo}** | ${fmtTime(f.depDateTime)}→${fmtTime(f.arrDateTime)} | ${fmtParty(f.priceNum)} | ${sameDay} | ${book} |\n`;
}

function renderReturnCompare(inboundByDate) {
  const dates = TRIP.returnDateCompare?.length ? TRIP.returnDateCompare : CFG.returnDates;
  if (!dates.length) return "";

  let md = `## 返程日期对比\n\n`;
  if (dates.length >= 2) {
    md += `| 对比项 | ${dates.map((d) => formatDateShort(d)).join(" | ")} |\n`;
    md += `|--------|${dates.map(() => "------").join("|")}|\n`;
    const cheapestByDate = dates.map((d) => {
      const list = inboundByDate.get(d) || [];
      const verified = list.filter((f) => f.priceVerified !== false);
      return verified.sort((a, b) => a.priceNum - b.priceNum)[0] || null;
    });
    const prices = cheapestByDate.map((f) => (f ? f.priceNum * PARTY : null));
    md += `| ${PARTY}人最低价 | ${prices.map((p) => (p != null ? `¥${p.toFixed(0)}` : "—")).join(" | ")} |\n\n`;
  }

  md += `### 各日场景推荐\n\n`;
  md += `| 场景 | 航班 | 时间 | 价格 | 当日到 | 预订 |\n`;
  md += `|------|------|------|------|--------|------|\n`;
  for (const d of dates) {
    const list = inboundByDate.get(d) || [];
    const verified = list.filter((f) => f.priceVerified !== false);
    const cheapest = pickScenario(verified, "cheapest", PROFILE);
    const elder = pickScenario(verified, "elder", PROFILE);
    const sameDay = pickScenario(verified, "same_day", PROFILE);
    md += renderFlightRow(`${formatDateShort(d)} 最低价`, cheapest);
    md += renderFlightRow(`${formatDateShort(d)} 老人推荐`, elder);
    if (sameDay) md += renderFlightRow(`${formatDateShort(d)} 当日到`, sameDay);
  }
  return md + "\n";
}

function renderPriceDeltas(results) {
  const rows = results.filter((r) => isConfiguredMonitorEntry(r, CFG));
  const inboundOnly = TRIP.skipOutboundMonitor || TRIP.bookedOutbound;
  const filtered = inboundOnly ? rows.filter((r) => !isOutboundRoute(r.route, CFG)) : rows;
  if (!filtered.length) return "";
  let md = `## 返程价格变动\n\n`;
  let any = false;
  for (const r of filtered) {
    const delta = getDeltaForRoute(r.route, r.date);
    const low = lowestPriceFromFlights(r.flights);
    if (low == null) continue;
    any = true;
    md += `- **${r.route}** ${r.date} 当前最低 ¥${low.toFixed(0)}`;
    if (delta) md += ` — ${delta}`;
    md += "\n";
  }
  return any ? md + "\n" : "";
}

function main() {
  const { inputPath } = parseArgs(process.argv);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Missing results file: ${inputPath}`);
  }

  const raw = fs.readFileSync(inputPath, "utf8");
  const results = compactMap(buildRouteMap(parseJsonl(raw))).filter(
    (r) => isConfiguredMonitorEntry(r, CFG) || r.adjacentFallback
  );
  const all = flattenFlights(results);
  const inbound = all.filter((f) => !isOutboundRoute(f.route, CFG));
  const inboundByDate = new Map();
  for (const f of inbound) {
    if (!inboundByDate.has(f.date)) inboundByDate.set(f.date, []);
    inboundByDate.get(f.date).push(f);
  }

  let md = `# 返程机票简报\n\n`;
  md += `> 生成时间：${formatShanghaiTime()} | 评分画像：**${PROFILE.label}** | **${PARTY} 人**\n\n`;
  if (TRIP.bookedOutbound) {
    const b = TRIP.bookedOutbound;
    md += `**已订去程：** ${b.route} ${b.date} ${b.flightNo || ""} — ${b.note || ""}\n\n`;
  }
  md += renderPhase2Notice(TRIP);
  md += `> 完整 TOP3 见 \`reports/xinjiang-flights-ranked.md\` · D8 行程衔接见 \`skill:plan\`\n\n`;

  md += renderInventoryAlert(results, TRIP, CFG);
  md += renderTargetPriceAlert(
    inbound.filter((f) => f.priceVerified !== false),
    TRIP,
    PARTY
  );
  md += renderReturnCompare(inboundByDate);
  md += renderPriceDeltas(results);
  md += `---\n基于飞猪 fly.ai 实时数据 · 机票简报由 \`format-flights-brief.js\` 自动生成\n`;
  process.stdout.write(md);
}

main();
