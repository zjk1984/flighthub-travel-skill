#!/usr/bin/env node
/**
 * Format Xinjiang flight monitor results into markdown report
 * Usage: node format-xinjiang-report.js < results.jsonl
 */
const fs = require("fs");
const { formatShanghaiTime } = require("./format-time");
const { parseJsonl, buildRouteMap, compactMap, parsePrice } = require("./flight-store");
const {
  loadConfig,
  labelCity,
  formatDateRange,
  formatCoverage,
  parseRoute,
  isOutboundRoute,
  remoteCity,
} = require("./load-monitor-config");

const CFG = loadConfig();
const DESTINATIONS = CFG.destinations;
const ORIGINS = CFG.origins;

function isOutbound(route) {
  return isOutboundRoute(route, CFG);
}

function xinjiangCity(route) {
  return remoteCity(route, CFG);
}

const raw = fs.readFileSync(process.argv[2] || 0, "utf8");
const results = compactMap(buildRouteMap(parseJsonl(raw)));

const timeSlot = t => {
  const h = parseInt(t.slice(11, 13), 10);
  if (h >= 6 && h < 10) return "早班";
  if (h >= 10 && h < 14) return "上午";
  if (h >= 14 && h < 18) return "下午";
  return "晚班";
};
const slotEmoji = { "早班": "🌅", "上午": "☀️", "下午": "🌆", "晚班": "🌙" };
const slotRange = { "早班": "06:00-10:00", "上午": "10:00-14:00", "下午": "14:00-18:00", "晚班": "18:00-24:00" };

function journeyLabel(f) {
  if (f.customTransfer) return `自定义中转(${f.transitCity || "枢纽"})`;
  if (f.journeyType === "中转") return "中转";
  return "直达";
}

function formatFlight(f) {
  const dep = f.depDateTime.slice(11, 16);
  const arr = f.arrDateTime.slice(11, 16);
  const price = f.price.includes("¥") ? f.price : `¥${parseFloat(f.price).toFixed(0)}`;
  const type = f.customTransfer
    ? "🔗"
    : f.journeyType === "中转" || f.journeyType === "自定义中转"
      ? "🔄"
      : "✈️";
  const label = f.customTransfer ? ` ${journeyLabel(f)}` : "";
  return `| ${dep} | ${f.depStation} | ${arr} | ${f.arrStation} | ${type} ${f.flightNo}${label} | ${f.airline} | ${price} |`;
}

function renderBookingLinks(f) {
  if (f.customTransfer && f.leg1JumpUrl && f.leg2JumpUrl) {
    return `[第一段预订](${f.leg1JumpUrl}) | [第二段预订](${f.leg2JumpUrl})（分段购票）\n\n`;
  }
  if (f.jumpUrl) return `[点击预订](${f.jumpUrl})\n\n`;
  return "";
}

function renderRouteDate(r) {
  const flights = r.flights || [];
  if (r.apiError && !flights.length) {
    const msg =
      r.apiError === "451:circuit_open_skipped"
        ? "⚡ 风控熔断，本航线已跳过（请稍后单独重跑）"
        : `⚠️ API 查询失败：\`${r.apiError}\`（非无航班，请稍后重试）`;
    return `### ${r.route} | ${r.date}\n\n${msg}\n\n`;
  }
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
  md += `**${cheapest.flightNo}** ${cheapest.airline} ${cheapest.depDateTime.slice(11, 16)} ${cheapest.depStation}→${cheapest.arrStation} **¥${parseFloat(cheapest.price).toFixed(0)}**`;
  md += `（${journeyLabel(cheapest)}）`;
  md += `\n\n`;
  md += renderBookingLinks(cheapest);
  return md;
}

let totalApi = 0;
let md = `# ✈️ ${CFG.routeLabel} 低价机票监控报告\n\n`;
md += `> 生成时间：${formatShanghaiTime()} (Asia/Shanghai)\n\n`;
md += `> 覆盖目的地：${formatCoverage(DESTINATIONS)}\n\n`;

const outbound = results.filter(r => isOutbound(r.route));
const inbound = results.filter(r => !isOutbound(r.route));

md += `## 📋 最低价速览\n\n`;
md += "| 方向 | 日期 | 航线 | 类型 | 最低价 | 航班 | 出发时间 |\n";
md += "|------|------|------|------|--------|------|----------|\n";

for (const r of [...outbound, ...inbound]) {
  totalApi += r.apiCount || 0;
  const flights = r.flights || [];
  if (!flights.length) continue;
  const best = [...flights].sort((a, b) => parsePrice(a.price) - parsePrice(b.price))[0];
  const dir = isOutbound(r.route) ? "去程" : "返程";
  const type = journeyLabel(best);
  md += `| ${dir} | ${r.date} | ${r.route} | ${type} | ¥${parseFloat(best.price).toFixed(0)} | ${best.flightNo} | ${best.depDateTime.slice(11, 16)} |\n`;
}

const allFlights = results.flatMap(r => (r.flights || []).map(f => ({ ...f, route: r.route, date: r.date })));
const globalBest = {
  outbound: allFlights.filter(f => isOutbound(f.route)).sort((a, b) => parsePrice(a.price) - parsePrice(b.price))[0],
  inbound: allFlights.filter(f => !isOutbound(f.route)).sort((a, b) => parsePrice(a.price) - parsePrice(b.price))[0],
};

const outRange = formatDateRange(CFG.outboundDates);
const inRange = formatDateRange(CFG.returnDates);

md += `\n## 🏆 全程最优推荐（跨所有目的地）\n\n`;
if (globalBest.outbound) {
  const f = globalBest.outbound;
  md += `- **去程最优（${outRange}）**：${f.date} ${f.route} **${f.flightNo}** ¥${parseFloat(f.price).toFixed(0)} ${f.depDateTime.slice(11, 16)} 出发（${journeyLabel(f)}）\n`;
}
if (globalBest.inbound) {
  const f = globalBest.inbound;
  md += `- **返程最优（${inRange}）**：${f.date} ${f.route} **${f.flightNo}** ¥${parseFloat(f.price).toFixed(0)} ${f.depDateTime.slice(11, 16)} 出发（${journeyLabel(f)}）\n`;
}
if (globalBest.outbound && globalBest.inbound) {
  const total = parsePrice(globalBest.outbound.price) + parsePrice(globalBest.inbound.price);
  md += `- **往返合计参考**：约 **¥${total.toFixed(0)}**（${globalBest.outbound.date} 去 + ${globalBest.inbound.date} 回）\n`;
}

md += `\n## 🗺️ 各目的地最低价对比\n\n`;
md += "| 目的地 | 去程最低 | 返程最低 |\n|------|----------|----------|\n";
for (const city of DESTINATIONS) {
  const outBest = allFlights
    .filter(f => isOutbound(f.route) && xinjiangCity(f.route) === city)
    .sort((a, b) => parsePrice(a.price) - parsePrice(b.price))[0];
  const inBest = allFlights
    .filter(f => !isOutbound(f.route) && xinjiangCity(f.route) === city)
    .sort((a, b) => parsePrice(a.price) - parsePrice(b.price))[0];
  const outStr = outBest ? `¥${parseFloat(outBest.price).toFixed(0)} (${outBest.date.slice(5)})` : "无航班";
  const inStr = inBest ? `¥${parseFloat(inBest.price).toFixed(0)} (${inBest.date.slice(5)})` : "无航班";
  md += `| ${labelCity(city)} | ${outStr} | ${inStr} |\n`;
}

md += `\n---\n\n## 去程详情（${outRange} ${ORIGINS.join("/")} → 目的地）\n\n`;
for (const city of DESTINATIONS) {
  const cityRoutes = outbound.filter(r => xinjiangCity(r.route) === city);
  if (!cityRoutes.length) continue;
  md += `### ${labelCity(city)}\n\n`;
  for (const r of cityRoutes.sort((a, b) => a.date.localeCompare(b.date) || a.route.localeCompare(b.route))) {
    md += renderRouteDate(r);
  }
}

md += `\n---\n\n## 返程详情（${inRange} 目的地 → ${ORIGINS.join("/")}）\n\n`;
for (const city of DESTINATIONS) {
  const cityRoutes = inbound.filter(r => xinjiangCity(r.route) === city);
  if (!cityRoutes.length) continue;
  md += `### ${labelCity(city)}\n\n`;
  for (const r of cityRoutes.sort((a, b) => a.date.localeCompare(b.date) || a.route.localeCompare(b.route))) {
    md += renderRouteDate(r);
  }
}

md += `\n---\n📊 本次查询总 API 消耗：**${totalApi}** 次\n\n`;

const apiErrors = results.filter((r) => r.apiError);
if (apiErrors.length) {
  md += `## ⚠️ API 查询失败（${apiErrors.length} 条航线）\n\n`;
  md += `以下航线因限流/风控等原因未拿到数据，**不代表无航班**：\n\n`;
  for (const r of apiErrors.slice(0, 20)) {
    md += `- ${r.date} ${r.route}：\`${r.apiError}\`\n`;
  }
  if (apiErrors.length > 20) md += `- … 另有 ${apiErrors.length - 20} 条\n`;
  md += `\n`;
}

md += `基于飞猪 fly.ai 实时数据\n`;

process.stdout.write(md);
