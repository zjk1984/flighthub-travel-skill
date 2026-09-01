#!/usr/bin/env node
/**
 * Score and rank flights by price, duration, and transfer count.
 * Lower score = better. Reads monitor JSONL from stdin.
 */
const fs = require("fs");

const XINJIANG = ["乌鲁木齐", "伊宁", "阿勒泰", "石河子"];
const GUANGDONG = ["深圳", "广州"];
const CITY_LABEL = { 伊宁: "伊犁（伊宁）" };

const WEIGHTS = { price: 0.5, duration: 0.25, transfer: 0.25 };

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

function flattenFlights(results) {
  const seen = new Map();
  for (const r of results) {
    for (const f of r.flights || []) {
      const key = `${f.depDateTime}|${f.flightNo}`;
      if (!seen.has(key)) {
        seen.set(key, {
          ...f,
          route: r.route,
          date: r.date,
          priceNum: parsePrice(f.price),
          durationMin: parseDurationMinutes(f),
          transfers: transferCount(f),
        });
      }
    }
  }
  return [...seen.values()];
}

function scoreFlights(flights) {
  if (!flights.length) return [];
  const prices = flights.map(f => f.priceNum);
  const durations = flights.map(f => f.durationMin);
  const transfers = flights.map(f => f.transfers);
  const normP = normalize(prices);
  const normD = normalize(durations);
  const normT = normalize(transfers);
  return flights.map((f, i) => ({
    ...f,
    score: Math.round(
      (normP[i] * WEIGHTS.price + normD[i] * WEIGHTS.duration + normT[i] * WEIGHTS.transfer) * 1000
    ) / 10,
  })).sort((a, b) => a.score - b.score || a.priceNum - b.priceNum);
}

function renderTable(flights, title) {
  let md = `## ${title}\n\n`;
  md += `> 评分公式：综合分 = 价格×50% + 飞行时长×25% + 转机次数×25%（归一化后，**越低越好**）\n\n`;
  md += "| 排名 | 评分 | 日期 | 航线 | 航班 | 类型 | 价格 | 飞行时间 | 转机 | 出发 | 到达 |\n";
  md += "|------|------|------|------|------|------|------|----------|------|------|------|\n";
  flights.forEach((f, i) => {
    const { origin, dest } = parseRoute(f.route);
    const destLabel = labelCity(dest);
    const originLabel = labelCity(origin);
    const routeDisplay = `${origin}→${destLabel === dest ? dest : destLabel}`;
    md += `| ${i + 1} | ${f.score} | ${f.date.slice(5)} | ${routeDisplay} | ${f.flightNo} | ${f.journeyType} | ¥${f.priceNum.toFixed(0)} | ${formatDuration(f.durationMin)} | ${f.transfers} | ${f.depDateTime.slice(11, 16)} | ${f.arrDateTime.slice(11, 16)} |\n`;
  });
  md += "\n### 预订链接\n\n";
  flights.forEach((f, i) => {
    const url = f.jumpUrl || "#";
    md += `${i + 1}. **${f.date.slice(5)} ${f.route}** ${f.flightNo} ¥${f.priceNum.toFixed(0)} — [点击预订](${url})\n`;
  });
  return md + "\n";
}

const raw = fs.readFileSync("/dev/stdin", "utf8");
const results = parseJsonl(raw);
const all = flattenFlights(results);
const outbound = scoreFlights(all.filter(f => isOutbound(f.route)));
const inbound = scoreFlights(all.filter(f => !isOutbound(f.route)));

const topOut = outbound.slice(0, 10);
const topIn = inbound.slice(0, 10);

let md = `# ✈️ 广东 ↔ 新疆 综合评分 TOP10 推荐\n\n`;
md += `> 生成时间：${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC\n\n`;
md += `> 覆盖机场：乌鲁木齐、伊犁（伊宁）、阿勒泰、石河子\n\n`;
md += `- 去程范围：9/28 - 10/1 | 返程范围：10/6 - 10/8\n`;
md += `- 候选航班：去程 ${outbound.length} 条，返程 ${inbound.length} 条\n\n`;

if (topOut.length) md += renderTable(topOut, "🛫 去程 TOP10（深圳/广州 → 新疆）");
else md += "## 🛫 去程 TOP10\n\n暂无数据\n\n";

if (topIn.length) md += renderTable(topIn, "🛬 返程 TOP10（新疆 → 深圳/广州）");
else md += "## 🛬 返程 TOP10\n\n暂无数据\n\n";

md += `---\n基于飞猪 fly.ai 实时数据\n`;
process.stdout.write(md);
