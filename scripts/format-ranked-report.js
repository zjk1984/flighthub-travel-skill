#!/usr/bin/env node
/**
 * Score and rank flights by price, duration, transfer count, and city preference.
 * Outbound prefers 深圳 departure; inbound prefers 深圳 arrival.
 * Lower score = better. Reads monitor JSONL from stdin.
 */
const fs = require("fs");

const XINJIANG = ["乌鲁木齐", "伊宁", "阿勒泰", "石河子"];
const GUANGDONG = ["深圳", "广州"];
const CITY_LABEL = { 伊宁: "伊犁（伊宁）" };
const TOP_N = 3;

const WEIGHTS = { price: 0.4, duration: 0.2, transfer: 0.2, city: 0.2 };

const SCORE_DESC =
  "综合分 = 价格×40% + 飞行时长×20% + 转机次数×20% + 出发地偏好×20%（归一化后，**越低越好**；去程优先深圳出发，返程优先深圳到达）";

function labelCity(name) {
  return CITY_LABEL[name] || name;
}

function parseJsonl(raw) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "{") { if (depth === 0) start = i; depth++; }
    else if (raw[i] === "}") { depth--; if (depth === 0) parts.push(raw.slice(start, i + 1)); }
  }
  return parts.map(p => JSON.parse(p));
}

function parsePrice(p) {
  return parseFloat(String(p).replace(/[^0-9.]/g, "")) || 0;
}

function parseDurationMinutes(f) {
  const dep = new Date(f.depDateTime.replace(" ", "T"));
  const arr = new Date(f.arrDateTime.replace(" ", "T"));
  if (!isNaN(dep) && !isNaN(arr) && arr > dep) return (arr - dep) / 60000;
  const d = String(f.duration || "");
  const m = d.match(/(\d+)\s*分钟/);
  if (m) return parseInt(m[1], 10);
  if (/^\d+$/.test(d.trim())) return parseInt(d.trim(), 10);
  return 9999;
}

function transferCount(f) {
  if (f.journeyType === "直达") return 0;
  const segs = (f.flightNo || "").split("/").map(s => s.trim()).filter(Boolean);
  return Math.max(0, segs.length - 1);
}

function formatDuration(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h${m > 0 ? m + "m" : ""}` : `${m}m`;
}

function normalize(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0);
  return values.map(v => (v - min) / (max - min));
}

function parseRoute(route) {
  const [origin, dest] = route.split("→");
  return { origin, dest };
}

function isOutbound(route) {
  const { origin, dest } = parseRoute(route);
  return GUANGDONG.includes(origin) && XINJIANG.includes(dest);
}

function xinjiangCity(route) {
  const { origin, dest } = parseRoute(route);
  return isOutbound(route) ? dest : origin;
}

/** 去程：深圳=0 广州=1；返程：到达深圳=0 到达广州=1 */
function cityPreference(f, direction) {
  const { origin, dest } = parseRoute(f.route);
  if (direction === "outbound") return origin === "深圳" ? 0 : 1;
  return dest === "深圳" ? 0 : 1;
}

function flattenFlights(results) {
  const seen = new Map();
  for (const r of results) {
    for (const f of r.flights || []) {
      const key = `${f.depDateTime}|${f.flightNo}`;
      if (!seen.has(key)) {
        const { origin, dest } = parseRoute(r.route);
        seen.set(key, {
          ...f,
          route: r.route,
          date: r.date,
          origin,
          dest,
          xjAirport: isOutbound(r.route) ? dest : origin,
          priceNum: parsePrice(f.price),
          durationMin: parseDurationMinutes(f),
          transfers: transferCount(f),
        });
      }
    }
  }
  return [...seen.values()];
}

function scoreFlights(flights, direction) {
  if (!flights.length) return [];
  const prices = flights.map(f => f.priceNum);
  const durations = flights.map(f => f.durationMin);
  const transfers = flights.map(f => f.transfers);
  const cities = flights.map(f => cityPreference(f, direction));
  const normP = normalize(prices);
  const normD = normalize(durations);
  const normT = normalize(transfers);
  const normC = normalize(cities);
  return flights.map((f, i) => ({
    ...f,
    cityPref: cities[i],
    score: Math.round(
      (normP[i] * WEIGHTS.price +
        normD[i] * WEIGHTS.duration +
        normT[i] * WEIGHTS.transfer +
        normC[i] * WEIGHTS.city) *
        1000
    ) / 10,
  })).sort((a, b) => a.score - b.score || a.priceNum - b.priceNum);
}

/** 同航线同日期内，若最低价不到次低价的 65%，标记为待核实 */
function markPriceOutliers(flights) {
  const groups = new Map();
  for (const f of flights) {
    const key = `${f.route}|${f.date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.priceNum - b.priceNum);
    if (sorted.length < 2) continue;
    const low = sorted[0].priceNum;
    const second = sorted[1].priceNum;
    if (second > 0 && low / second < 0.65) {
      sorted[0].priceWarning = `API 报价 ¥${low.toFixed(0)} 明显低于同航线次低价 ¥${second.toFixed(0)}，预订页可能不一致`;
      sorted[0].priceVerified = false;
    }
  }
  return flights;
}

/** 每个新疆机场取评分最优 1 条，再按评分取 TOP N 机场 */
function topByXinjiangAirport(flights, direction, n = TOP_N) {
  const byAirport = new Map();
  for (const f of flights) {
    const airport = f.xjAirport;
    const prev = byAirport.get(airport);
    if (!prev || f.score < prev.score) byAirport.set(airport, f);
  }
  return [...byAirport.values()]
    .sort((a, b) => a.score - b.score || a.priceNum - b.priceNum)
    .slice(0, n);
}

/** 指定新疆机场取 TOP N 航班 */
function topForAirport(flights, airport, n = TOP_N) {
  return flights.filter(f => f.xjAirport === airport).slice(0, n);
}

function routeDisplay(f) {
  const destLabel = labelCity(f.dest);
  const originLabel = labelCity(f.origin);
  const d = destLabel === f.dest ? f.dest : destLabel;
  const o = originLabel === f.origin ? f.origin : originLabel;
  return `${o}→${d}`;
}

function renderTable(flights, title, extraNote = "") {
  if (!flights.length) return `## ${title}\n\n暂无航班数据\n\n`;
  let md = `## ${title}\n\n`;
  if (extraNote) md += `> ${extraNote}\n\n`;
  md += `> ${SCORE_DESC}\n\n`;
  md += "| 排名 | 评分 | 日期 | 出发地 | 航线 | 航班 | 类型 | 价格 | 飞行时间 | 转机 | 出发 | 到达 |\n";
  md += "|------|------|------|--------|------|------|------|------|----------|------|------|------|\n";
  flights.forEach((f, i) => {
    const warn = f.priceWarning ? ` ⚠️ ${f.priceWarning}` : "";
    md += `| ${i + 1} | ${f.score} | ${f.date.slice(5)} | ${f.origin} | ${routeDisplay(f)} | ${f.flightNo} | ${f.journeyType} | ¥${f.priceNum.toFixed(0)} | ${formatDuration(f.durationMin)} | ${f.transfers} | ${f.depDateTime.slice(11, 16)} | ${f.arrDateTime.slice(11, 16)} |${warn ? "" : ""}\n`;
  });
  md += "\n### 预订链接\n\n";
  flights.forEach((f, i) => {
    const url = f.jumpUrl || "#";
    const warn = f.priceWarning ? ` ⚠️${f.priceWarning}` : "";
    md += `${i + 1}. **${f.date.slice(5)} ${routeDisplay(f)}** ${f.flightNo} ¥${f.priceNum.toFixed(0)}${warn} — [点击预订](${url})\n`;
  });
  return md + "\n";
}

function renderAirportSections(flights, direction, label) {
  let md = `## ${label}\n\n> ${SCORE_DESC}\n\n`;
  let hasAny = false;
  for (const airport of XINJIANG) {
    const top = topForAirport(flights, airport, TOP_N);
    if (!top.length) {
      md += `### ${labelCity(airport)}\n\n暂无航班\n\n`;
      continue;
    }
    hasAny = true;
    md += `### ${labelCity(airport)} TOP${TOP_N}\n\n`;
    md += "| 排名 | 评分 | 日期 | 出发地 | 航线 | 航班 | 类型 | 价格 | 飞行时间 | 转机 |\n";
    md += "|------|------|------|--------|------|------|------|------|----------|------|\n";
    top.forEach((f, i) => {
      md += `| ${i + 1} | ${f.score} | ${f.date.slice(5)} | ${f.origin} | ${routeDisplay(f)} | ${f.flightNo} | ${f.journeyType} | ¥${f.priceNum.toFixed(0)} | ${formatDuration(f.durationMin)} | ${f.transfers} |\n`;
    });
    md += "\n**预订链接：**\n";
    top.forEach((f, i) => {
      md += `- ${i + 1}. [${f.date.slice(5)} ${routeDisplay(f)} ¥${f.priceNum.toFixed(0)}](${f.jumpUrl || "#"})\n`;
    });
    md += "\n";
  }
  return hasAny ? md : `## ${label}\n\n暂无数据\n\n`;
}

const raw = fs.readFileSync("/dev/stdin", "utf8");
const results = parseJsonl(raw);
const all = flattenFlights(results);
const outbound = markPriceOutliers(scoreFlights(all.filter(f => isOutbound(f.route)), "outbound"));
const inbound = markPriceOutliers(scoreFlights(all.filter(f => !isOutbound(f.route)), "inbound"));

const topOut = outbound.slice(0, TOP_N);
const topIn = inbound.slice(0, TOP_N);
const topOutAirports = topByXinjiangAirport(outbound, "outbound", TOP_N);
const topInAirports = topByXinjiangAirport(inbound, "inbound", TOP_N);

let md = `# ✈️ 广东 ↔ 新疆 综合评分 TOP${TOP_N} 推荐\n\n`;
md += `> 生成时间：${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC\n\n`;
md += `> 覆盖机场：乌鲁木齐、伊犁（伊宁）、阿勒泰、石河子\n\n`;
md += `- 去程范围：9/28 - 10/1 | 返程范围：10/6 - 10/8\n`;
md += `- 候选航班：去程 ${outbound.length} 条，返程 ${inbound.length} 条\n`;
md += `- **深圳优先**：去程优先深圳出发，返程优先深圳到达\n\n`;

md += renderTable(
  topOut,
  `🛫 去程 TOP${TOP_N}（深圳出发优先）`,
  "综合评分最优的去程航班，已纳入出发地偏好"
);
md += renderTable(
  topIn,
  `🛬 返程 TOP${TOP_N}（深圳到达优先）`,
  "综合评分最优的返程航班，已纳入到达地偏好"
);

md += renderTable(
  topOutAirports,
  `🗺️ 新疆机场去程 TOP${TOP_N}（各机场最优代表）`,
  "每个新疆机场取评分最高 1 条，再按综合分排序取前 3 个机场"
);
md += renderTable(
  topInAirports,
  `🗺️ 新疆机场返程 TOP${TOP_N}（各机场最优代表）`,
  "每个新疆机场取评分最高 1 条，再按综合分排序取前 3 个机场"
);

md += renderAirportSections(outbound, "outbound", "📍 各新疆机场去程 TOP3 明细");
md += renderAirportSections(inbound, "inbound", "📍 各新疆机场返程 TOP3 明细");

md += `---\n基于飞猪 fly.ai 实时数据\n`;
process.stdout.write(md);
