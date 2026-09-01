#!/usr/bin/env node
/**
 * Score flights: price, duration, transfers, departure & Xinjiang airport preference.
 * Higher score = better. Reads monitor JSONL from stdin.
 *
 * Preference points (fixed):
 *   出发地: 深圳 100, 广州 80
 *   新疆机场: 乌鲁木齐 80, 其他(伊宁/阿勒泰/石河子) 100
 */
const fs = require("fs");

const XINJIANG = ["乌鲁木齐", "伊宁", "阿勒泰", "石河子"];
const GUANGDONG = ["深圳", "广州"];
const CITY_LABEL = { 伊宁: "伊犁（伊宁）" };
const TOP_N = 3;

const PREF = {
  guangdong: { 深圳: 100, 广州: 80 },
  xjAirport: { 乌鲁木齐: 100, default: 100 },
};

const WEIGHTS = {
  price: 0.25,
  duration: 0.15,
  transfer: 0.15,
  depCity: 0.1,
  xjAirport: 0.1,
  depTime: 0.125,
  arrTime: 0.125,
};

const SCORE_DESC =
  "综合分 = 价格×25% + 时长×15% + 转机×15% + 出发地×10% + 目的地×10% + 起飞时间×12.5% + 落地时间×12.5%（**越高越好**）";

function transferPoints(count, depDateTime, arrDateTime) {
  let pts = Math.max(0, 100 - count * 25);
  const depDay = depDateTime.slice(0, 10);
  const arrDay = arrDateTime.slice(0, 10);
  if (depDay !== arrDay) pts = Math.max(0, pts - 25);
  return pts;
}

/** 07:00–22:00 为 100 分，其余 80 分 */
function timeSlotPoints(dateTimeStr) {
  const hour = parseInt(dateTimeStr.slice(11, 13), 10);
  return hour >= 7 && hour <= 22 ? 100 : 80;
}

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

function guangdongPref(f, direction) {
  const { origin, dest } = parseRoute(f.route);
  const city = direction === "outbound" ? origin : dest;
  return PREF.guangdong[city] ?? 80;
}

function xjAirportPref(airport) {
  return PREF.xjAirport[airport] ?? PREF.xjAirport.default;
}

function flattenFlights(results) {
  const seen = new Map();
  for (const r of results) {
    for (const f of r.flights || []) {
      const key = `${f.depDateTime}|${f.flightNo}`;
      if (!seen.has(key)) {
        const { origin, dest } = parseRoute(r.route);
        const xjAirport = isOutbound(r.route) ? dest : origin;
        seen.set(key, {
          ...f,
          route: r.route,
          date: r.date,
          origin,
          dest,
          xjAirport,
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
  const normP = normalize(prices);
  const normD = normalize(durations);

  return flights.map((f, i) => {
    const depPref = guangdongPref(f, direction);
    const xjPref = xjAirportPref(f.xjAirport);
    const transferPts = transferPoints(f.transfers, f.depDateTime, f.arrDateTime);
    const depTimePts = timeSlotPoints(f.depDateTime);
    const arrTimePts = timeSlotPoints(f.arrDateTime);
    const score =
      (1 - normP[i]) * WEIGHTS.price +
      (1 - normD[i]) * WEIGHTS.duration +
      (transferPts / 100) * WEIGHTS.transfer +
      (depPref / 100) * WEIGHTS.depCity +
      (xjPref / 100) * WEIGHTS.xjAirport +
      (depTimePts / 100) * WEIGHTS.depTime +
      (arrTimePts / 100) * WEIGHTS.arrTime;
    return {
      ...f,
      depPref,
      xjPref,
      transferPts,
      depTimePts,
      arrTimePts,
      score: Math.round(score * 1000) / 10,
    };
  }).sort((a, b) => b.score - a.score || a.priceNum - b.priceNum);
}

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
      sorted[0].priceWarning = `API 报价 ¥${low.toFixed(0)} 低于次低价 ¥${second.toFixed(0)}，预订页可能不一致`;
      sorted[0].priceVerified = false;
    }
  }
  return flights;
}

function rankCompare(a, b) {
  if (a.priceVerified === false && b.priceVerified !== false) return 1;
  if (b.priceVerified === false && a.priceVerified !== false) return -1;
  return b.score - a.score || a.priceNum - b.priceNum;
}

function topByDay(flights, n = TOP_N) {
  const byDate = new Map();
  for (const f of flights) {
    if (!byDate.has(f.date)) byDate.set(f.date, []);
    byDate.get(f.date).push(f);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, list]) => ({
      date,
      flights: [...list].sort(rankCompare).slice(0, n),
    }));
}

function routeDisplay(f) {
  const d = labelCity(f.dest);
  const o = labelCity(f.origin);
  return `${f.origin === o ? f.origin : o}→${f.dest === d ? f.dest : d}`;
}

function renderDailySections(days, title, direction) {
  let md = `## ${title}\n\n> ${SCORE_DESC}\n\n`;
  if (!days.length) return md + "暂无数据\n\n";
  const col1 = direction === "outbound" ? "出发地" : "新疆出发";
  const col2 = direction === "outbound" ? "目的地" : "到达地";
  for (const { date, flights } of days) {
    md += `### ${date.slice(5)}（${date}）\n\n`;
    if (!flights.length) {
      md += "暂无航班\n\n";
      continue;
    }
    md += `| 排名 | 评分 | ${col1} | ${col2} | 航线 | 航班 | 类型 | 价格 | 时长 | 转机分 | 起飞分 | 落地分 | 出发 | 到达 |\n`;
    md += "|------|------|--------|--------|------|------|------|------|------|--------|--------|--------|------|------|\n";
    flights.forEach((f, i) => {
      const xjLabel = labelCity(f.xjAirport);
      let c1, c2;
      if (direction === "outbound") {
        c1 = `${f.origin}(${f.depPref})`;
        c2 = `${xjLabel}(${f.xjPref})`;
      } else {
        c1 = `${xjLabel}(${f.xjPref})`;
        c2 = `${f.dest}(${f.depPref})`;
      }
      md += `| ${i + 1} | ${f.score} | ${c1} | ${c2} | ${routeDisplay(f)} | ${f.flightNo} | ${f.journeyType} | ¥${f.priceNum.toFixed(0)} | ${formatDuration(f.durationMin)} | ${f.transferPts} | ${f.depTimePts} | ${f.arrTimePts} | ${f.depDateTime.slice(11, 16)} | ${f.arrDateTime.slice(11, 16)} |\n`;
    });
    md += "\n**预订链接：**\n";
    flights.forEach((f, i) => {
      const warn = f.priceWarning ? ` ⚠️${f.priceWarning}` : "";
      md += `${i + 1}. [${routeDisplay(f)} ${f.flightNo} ¥${f.priceNum.toFixed(0)} 评分${f.score}${warn}](${f.jumpUrl || "#"})\n`;
    });
    md += "\n";
  }
  return md;
}

const raw = fs.readFileSync("/dev/stdin", "utf8");
const results = parseJsonl(raw);
const all = flattenFlights(results);
const outbound = markPriceOutliers(scoreFlights(all.filter(f => isOutbound(f.route)), "outbound"));
const inbound = markPriceOutliers(scoreFlights(all.filter(f => !isOutbound(f.route)), "inbound"));

const outByDay = topByDay(outbound);
const inByDay = topByDay(inbound);

let md = `# ✈️ 广东 ↔ 新疆 每日 TOP3 评分推荐\n\n`;
md += `> 生成时间：${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC\n\n`;
md += `> 覆盖机场：乌鲁木齐、伊犁（伊宁）、阿勒泰、石河子\n\n`;
md += `- 去程：9/28 - 10/1 | 返程：10/6 - 10/8\n`;
md += `- 候选航班：去程 ${outbound.length} 条，返程 ${inbound.length} 条\n\n`;
md += `### 偏好分设定\n\n`;
md += `| 维度 | 选项 | 偏好分 |\n|------|------|--------|\n`;
md += `| 出发地（去程）/ 到达地（返程） | 深圳 | 100 |\n`;
md += `| 出发地（去程）/ 到达地（返程） | 广州 | 80 |\n`;
md += `| 目的地（去程）/ 出发地（返程） | 乌鲁木齐/伊宁/阿勒泰/石河子 | 100 |\n`;
md += `| 转机次数 | 0 次 | 100 |\n`;
md += `| 转机次数 | 每多 1 次 | -25（最低 0） |\n`;
md += `| 转机次数 | 跨天（出发日与到达日不同） | 额外 -25 |\n`;
md += `| 起飞/落地时间 | 07:00–22:00 | 100 |\n`;
md += `| 起飞/落地时间 | 其他时段 | 80 |\n\n`;

md += renderDailySections(outByDay, "🛫 去程每日 TOP3", "outbound");
md += renderDailySections(inByDay, "🛬 返程每日 TOP3", "inbound");

md += `---\n基于飞猪 fly.ai 实时数据\n`;
process.stdout.write(md);
