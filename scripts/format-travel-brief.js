#!/usr/bin/env node
/**
 * One-page travel decision brief from JSONL + trip profile + optional hotels.
 *
 * Usage: node format-travel-brief.js [results.jsonl] [--hotels hotels.json]
 */
const fs = require("fs");
const path = require("path");
const { formatShanghaiTime } = require("./format-time");
const { parseJsonl, buildRouteMap, compactMap } = require("./flight-store");
const {
  loadConfig,
  labelCity,
  formatDateShort,
  parseRoute,
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
  loadHotelsBySegment,
  renderItineraryTable,
  renderHotelBookingSheet,
  renderCarRentalBrief,
  renderTodoBrief,
  renderTipsBrief,
} = require("./travel-plan-lib");

const ROOT = path.join(__dirname, "..");
const CFG = loadConfig();
const TRIP = CFG.trip || {};
const PARTY = TRIP.partySize || 1;
const PROFILE = getProfile(TRIP.scoringProfile || CFG.scoring?.profile || "default");

function parseArgs(argv) {
  let inputPath = path.join(ROOT, "reports/xinjiang-results.jsonl");
  let hotelsPath = path.join(ROOT, "reports/xinjiang-hotels-latest.json");
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--hotels" && argv[i + 1]) {
      hotelsPath = argv[++i];
      continue;
    }
    if (!argv[i].startsWith("-")) inputPath = argv[i];
  }
  return { inputPath, hotelsPath };
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
  const d = dt.slice(0, 10);
  const t = dt.slice(11, 16);
  return `${d.slice(5)} ${t}`;
}

function fmtParty(price) {
  const total = price * PARTY;
  return `¥${price.toFixed(0)}（${PARTY}人 ¥${total.toFixed(0)}）`;
}

function renderFlightRow(label, f) {
  if (!f) return `| ${label} | — | — | — | — |\n`;
  const sameDay = isSameDayArrival(f) ? "是" : "否";
  const book = f.jumpUrl ? `[预订](${f.jumpUrl})` : "—";
  return `| ${label} | **${f.flightNo}** | ${fmtTime(f.depDateTime)}→${fmtTime(f.arrDateTime)} | ${fmtParty(f.priceNum)} | ${sameDay} | ${book} |\n`;
}

function renderReturnCompare(inboundByDate) {
  const dates = TRIP.returnDateCompare?.length
    ? TRIP.returnDateCompare
    : CFG.returnDates;
  if (dates.length < 2) return "";

  let md = `## 返程日期对比\n\n`;
  md += `| 对比项 | ${dates.map((d) => formatDateShort(d)).join(" | ")} |\n`;
  md += `|--------|${dates.map(() => "------").join("|")}|\n`;

  const cheapestByDate = dates.map((d) => {
    const list = inboundByDate.get(d) || [];
    const verified = list.filter((f) => f.priceVerified !== false);
    return verified.sort((a, b) => a.priceNum - b.priceNum)[0] || null;
  });

  const prices = cheapestByDate.map((f) => (f ? f.priceNum * PARTY : null));
  md += `| 5人最低价 | ${prices.map((p) => (p != null ? `¥${p.toFixed(0)}` : "—")).join(" | ")} |\n`;

  const diff =
    prices[0] != null && prices[1] != null ? prices[1] - prices[0] : null;
  if (diff != null) {
    const cmp = diff < 0 ? "便宜" : diff > 0 ? "贵" : "相同";
    md += `\n> **结论：** ${formatDateShort(dates[1])} 比 ${formatDateShort(dates[0])} ${cmp}约 **¥${Math.abs(diff).toFixed(0)}**（${PARTY}人合计）\n\n`;
  }

  md += `### 各日场景推荐\n\n`;
  md += `| 场景 | 航班 | 时间 | 价格 | 当日到 | 预订 |\n`;
  md += `|------|------|------|------|--------|------|\n`;
  for (const d of dates) {
    const list = inboundByDate.get(d) || [];
    const verified = list.map((f) => ({ ...f, priceVerified: f.priceVerified !== false }));
    const cheapest = pickScenario(verified, "cheapest", PROFILE);
    const elder = pickScenario(verified, "elder", PROFILE);
    const sameDay = pickScenario(verified, "same_day", PROFILE);
    md += renderFlightRow(`${formatDateShort(d)} 最低价`, cheapest);
    md += renderFlightRow(`${formatDateShort(d)} 老人推荐`, elder);
    if (sameDay) md += renderFlightRow(`${formatDateShort(d)} 当日到`, sameDay);
  }
  return md + "\n";
}

function renderHotels(hotelsPath) {
  if (!fs.existsSync(hotelsPath)) return "";
  const hotels = normalizeHotelsForBrief(
    JSON.parse(fs.readFileSync(hotelsPath, "utf8"))
  );
  if (!hotels.length) return "";

  const { renderReport } = require("./format-hotels-ranked");
  const cfg = loadConfig();
  const full = renderReport(hotels, cfg);

  const start = full.indexOf("## 🏨 每日 TOP3");
  if (start < 0) return "";
  let section = full.slice(start).replace("## 🏨 每日 TOP3（按入住日）", "");
  section = section.replace(
    "---\n基于飞猪 fly.ai 实时数据\n",
    "> 完整评分标准与明细见 `reports/xinjiang-hotels-ranked.md`\n\n"
  );
  return section;
}

function normalizeHotelsForBrief(raw) {
  const { parsePriceNum } = require("./hotel-scoring");
  return raw.map((h) => ({
    ...h,
    priceNum: h.priceNum != null ? h.priceNum : parsePriceNum(h.price),
    reviewScore: h.reviewScore ?? h.score ?? null,
  }));
}

function renderPriceDeltas(results) {
  const rows = results.filter((r) => isConfiguredMonitorEntry(r, CFG));
  const inboundOnly = TRIP.skipOutboundMonitor || TRIP.bookedOutbound;
  const filtered = inboundOnly
    ? rows.filter((r) => !isOutboundRoute(r.route, CFG))
    : rows;
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
  const { inputPath, hotelsPath } = parseArgs(process.argv);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Missing results file: ${inputPath}`);
  }

  const raw = fs.readFileSync(inputPath, "utf8");
  const results = compactMap(buildRouteMap(parseJsonl(raw))).filter((r) =>
    isConfiguredMonitorEntry(r, CFG)
  );
  const all = flattenFlights(results);
  const inbound = all.filter((f) => !isOutboundRoute(f.route, CFG));
  const inboundByDate = new Map();
  for (const f of inbound) {
    if (!inboundByDate.has(f.date)) inboundByDate.set(f.date, []);
    inboundByDate.get(f.date).push(f);
  }

  let md = `# 旅行决策简报（返程 · 行程 · 酒店）\n\n`;
  md += `> 生成时间：${formatShanghaiTime()} | 评分画像：**${PROFILE.label}** | **${PARTY} 人**\n\n`;
  if (TRIP.label) md += `> 行程：${TRIP.label}\n\n`;
  if (TRIP.bookedOutbound) {
    const b = TRIP.bookedOutbound;
    md += `**已订去程：** ${b.route} ${b.date} ${b.flightNo || ""} — ${b.note || ""}\n\n`;
  }
  if (TRIP.skipOutboundMonitor || TRIP.bookedOutbound) {
    md += `> 模式：**返程 + 行程 + 酒店安排**（去程已订，不再查询）\n\n`;
  } else if (CFG.focusMode) {
    md += `> 模式：聚焦盯票（仅查询 trip-profile 指定航线）\n\n`;
  }

  const hotelsBySegment = loadHotelsBySegment(hotelsPath, TRIP, PARTY);
  md += renderItineraryTable(TRIP, hotelsBySegment);
  md += renderHotelBookingSheet(TRIP, hotelsBySegment);
  md += renderCarRentalBrief(TRIP.itinerary);
  md += renderTodoBrief(TRIP, inboundByDate, PROFILE);
  md += renderTipsBrief(TRIP.itinerary);

  md += `---\n\n`;
  md += renderReturnCompare(inboundByDate);
  md += renderPriceDeltas(results);
  md += `## 酒店评分明细（各段 TOP3）\n\n`;
  md += renderHotels(hotelsPath);
  md += `---\n基于飞猪 fly.ai 实时数据 · 决策简报由 \`format-travel-brief.js\` 自动生成\n`;
  process.stdout.write(md);
}

main();
