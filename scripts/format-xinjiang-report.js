#!/usr/bin/env node
/**
 * Format Xinjiang flight monitor results into markdown report
 * Usage: node format-xinjiang-report.js < results.jsonl
 */
const fs = require("fs");

const raw = fs.readFileSync("/dev/stdin", "utf8");
const parts = [];
let depth = 0, start = 0;
for (let i = 0; i < raw.length; i++) {
  if (raw[i] === "{") { if (depth === 0) start = i; depth++; }
  else if (raw[i] === "}") { depth--; if (depth === 0) parts.push(raw.slice(start, i + 1)); }
}

const results = parts.map(p => JSON.parse(p));
const parsePrice = p => parseFloat(String(p).replace(/[^0-9.]/g, "")) || 999999;
const timeSlot = t => {
  const h = parseInt(t.slice(11, 13), 10);
  if (h >= 6 && h < 10) return "早班";
  if (h >= 10 && h < 14) return "上午";
  if (h >= 14 && h < 18) return "下午";
  return "晚班";
};
const slotEmoji = { "早班": "🌅", "上午": "☀️", "下午": "🌆", "晚班": "🌙" };
const slotRange = { "早班": "06:00-10:00", "上午": "10:00-14:00", "下午": "14:00-18:00", "晚班": "18:00-24:00" };

function formatFlight(f) {
  const dep = f.depDateTime.slice(11, 16);
  const arr = f.arrDateTime.slice(11, 16);
  const price = f.price.includes("¥") ? f.price : `¥${parseFloat(f.price).toFixed(0)}`;
  return `| ${dep} | ${f.depStation} | ${arr} | ${f.arrStation} | ${f.flightNo} | ${f.airline} | ${price} |`;
}

function renderRouteDate(r) {
  const flights = r.flights || [];
  if (!flights.length) return `### ${r.route} | ${r.date}\n\n暂无航班数据\n`;
  
  const sorted = [...flights].sort((a, b) => a.depDateTime.localeCompare(b.depDateTime));
  const cheapest = [...flights].sort((a, b) => parsePrice(a.price) - parsePrice(b.price))[0];
  const totalApi = r.apiCount || 0;
  
  let md = `### ${r.route} | ${r.date}\n\n共 **${flights.length}** 趟 | 📊 API 消耗：${totalApi} 次\n\n`;
  
  for (const slot of ["早班", "上午", "下午", "晚班"]) {
    const slotFlights = sorted.filter(f => timeSlot(f.depDateTime) === slot);
    if (!slotFlights.length) continue;
    md += `#### ${slotEmoji[slot]} ${slot}（${slotRange[slot]}）\n\n`;
    md += "| 出发时间 | 出发机场 | 到达时间 | 到达机场 | 航班号 | 航空公司 | 价格 |\n";
    md += "|----------|----------|----------|----------|--------|----------|------|\n";
    for (const f of slotFlights) md += formatFlight(f) + "\n";
    const best = [...slotFlights].sort((a, b) => parsePrice(a.price) - parsePrice(b.price))[0];
    md += `\n> 💡 ${slot}推荐：**${best.flightNo}** ¥${parseFloat(best.price).toFixed(0)} — 该时段最低价\n\n`;
  }
  
  md += `#### 💰 当日最低价\n\n`;
  md += `**${cheapest.flightNo}** ${cheapest.airline} ${cheapest.depDateTime.slice(11,16)} ${cheapest.depStation}→${cheapest.arrStation} **¥${parseFloat(cheapest.price).toFixed(0)}**\n\n`;
  if (cheapest.jumpUrl) md += `[点击预订](${cheapest.jumpUrl})\n\n`;
  return md;
}

let totalApi = 0;
let md = `# ✈️ 广东 ↔ 新疆 低价机票监控报告\n\n`;
md += `> 生成时间：${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC\n\n`;

// Summary table
md += `## 📋 最低价速览\n\n`;
md += "| 方向 | 日期 | 航线 | 最低价 | 航班 | 出发时间 |\n";
md += "|------|------|------|--------|------|----------|\n";

const outbound = results.filter(r => r.route.includes("→乌鲁木齐"));
const inbound = results.filter(r => r.route.startsWith("乌鲁木齐→"));

for (const r of [...outbound, ...inbound]) {
  totalApi += r.apiCount || 0;
  const flights = r.flights || [];
  if (!flights.length) continue;
  const best = [...flights].sort((a, b) => parsePrice(a.price) - parsePrice(b.price))[0];
  const dir = r.route.includes("→乌鲁木齐") ? "去程" : "返程";
  md += `| ${dir} | ${r.date} | ${r.route} | ¥${parseFloat(best.price).toFixed(0)} | ${best.flightNo} | ${best.depDateTime.slice(11,16)} |\n`;
}

// Global cheapest
const allFlights = results.flatMap(r => (r.flights || []).map(f => ({ ...f, route: r.route, date: r.date })));
const globalBest = {
  outbound: allFlights.filter(f => f.route.includes("→乌鲁木齐")).sort((a,b) => parsePrice(a.price)-parsePrice(b.price))[0],
  inbound: allFlights.filter(f => f.route.startsWith("乌鲁木齐→")).sort((a,b) => parsePrice(a.price)-parsePrice(b.price))[0],
};

md += `\n## 🏆 全程最优推荐\n\n`;
if (globalBest.outbound) {
  const f = globalBest.outbound;
  md += `- **去程最优（9/28-10/1）**：${f.date} ${f.route} **${f.flightNo}** ¥${parseFloat(f.price).toFixed(0)} ${f.depDateTime.slice(11,16)} 出发\n`;
}
if (globalBest.inbound) {
  const f = globalBest.inbound;
  md += `- **返程最优（10/6-10/8）**：${f.date} ${f.route} **${f.flightNo}** ¥${parseFloat(f.price).toFixed(0)} ${f.depDateTime.slice(11,16)} 出发\n`;
}
if (globalBest.outbound && globalBest.inbound) {
  const total = parsePrice(globalBest.outbound.price) + parsePrice(globalBest.inbound.price);
  md += `- **往返合计参考**：约 **¥${total.toFixed(0)}**（${globalBest.outbound.date} 去 + ${globalBest.inbound.date} 回）\n`;
}

md += `\n---\n\n## 去程详情（9/28 - 10/1 深圳/广州 → 乌鲁木齐）\n\n`;
for (const r of outbound) md += renderRouteDate(r);

md += `\n---\n\n## 返程详情（10/6 - 10/8 乌鲁木齐 → 深圳/广州）\n\n`;
for (const r of inbound) md += renderRouteDate(r);

md += `\n---\n📊 本次查询总 API 消耗：**${totalApi}** 次\n\n`;
md += `基于飞猪 fly.ai 实时数据\n`;

process.stdout.write(md);
