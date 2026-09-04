/**
 * Return flight preferences: time window, target price, feasibility.
 */
const { parseRoute } = require("./load-monitor-config");

function parseTimeToMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== "string") return null;
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function depMinutes(f) {
  const t = f?.depDateTime?.slice(11, 16);
  return parseTimeToMinutes(t);
}

function getReturnPreferences(trip) {
  const p = trip?.returnPreferences || {};
  return {
    minDepartureTime: p.minDepartureTime || "12:00",
    targetPricePerPerson: p.targetPricePerPerson > 0 ? p.targetPricePerPerson : null,
    adjacentDayFallback: p.adjacentDayFallback !== false,
    note: p.note || "",
  };
}

function isFeasibleReturnFlight(f, prefs) {
  if (!f || isOutboundLike(f)) return true;
  const min = parseTimeToMinutes(prefs.minDepartureTime);
  const dep = depMinutes(f);
  if (min == null || dep == null) return true;
  return dep >= min;
}

function isOutboundLike(f) {
  return false;
}

function splitFeasible(flights, trip) {
  const prefs = getReturnPreferences(trip);
  const feasible = [];
  const other = [];
  for (const f of flights) {
    if (isFeasibleReturnFlight(f, prefs)) feasible.push(f);
    else other.push(f);
  }
  return { feasible, other, prefs };
}

function countMainApiFlights(entry) {
  return (entry?.flights || []).filter((f) => !f.customTransfer).length;
}

function countCustomFlights(entry) {
  return (entry?.flights || []).filter((f) => f.customTransfer).length;
}

function addDays(dateStr, delta) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function primaryReturnDates(trip, cfg) {
  const dates = new Set(cfg?.returnDates || []);
  for (const r of trip?.focusRoutes?.inbound || []) {
    for (const d of r.dates || []) dates.add(d);
  }
  return [...dates].sort();
}

function inboundRoutes(trip) {
  return trip?.focusRoutes?.inbound || [];
}

function renderInventoryAlert(results, trip, cfg) {
  const dates = primaryReturnDates(trip, cfg);
  const lines = [];
  for (const r of results) {
    if (dates.length && !dates.includes(r.date)) continue;
    const { origin, dest } = parseRoute(r.route);
    const isInbound = trip?.focusRoutes?.inbound?.some(
      (fr) => fr.origin === origin && fr.dest === dest
    );
    if (!isInbound && dates.length) continue;
    const main = countMainApiFlights(r);
    const custom = countCustomFlights(r);
    if (r.adjacentFallback) continue;
    if (main === 0) {
      lines.push(
        `- **${r.route} ${r.date}** — 主查询 **0 条**（fly.ai「智慧交通结果为空」或暂无联程库存）` +
          (custom > 0 ? `；仅有自定义中转 **${custom} 条**` : "")
      );
    }
  }
  if (!lines.length) return "";
  return (
    `## ⚠️ 库存告警\n\n` +
    `> 以下日期主查询无联程结果，TOP3 可能仅含自定义中转或与行程冲突的航班；请以 App 实价为准或查看下方「相邻日参考」。\n\n` +
    lines.join("\n") +
    `\n\n`
  );
}

function renderTargetPriceAlert(flights, trip, partySize = 1) {
  const prefs = getReturnPreferences(trip);
  if (!prefs.targetPricePerPerson) return "";
  const verified = flights.filter((f) => f.priceVerified !== false);
  const feasible = verified.filter((f) => isFeasibleReturnFlight(f, prefs));
  const pool = feasible.length ? feasible : verified;
  if (!pool.length) return "";
  const best = pool.reduce((a, b) => (a.priceNum < b.priceNum ? a : b));
  if (best.priceNum > prefs.targetPricePerPerson) return "";
  const total = best.priceNum * partySize;
  return (
    `## 🔔 目标价提醒\n\n` +
    `> **${best.flightNo}** ${best.depDateTime?.slice(11, 16)} 起 — **¥${best.priceNum.toFixed(0)}/人**` +
    `（${partySize} 人 ≈ ¥${total.toFixed(0)}）≤ 目标 ¥${prefs.targetPricePerPerson}/人\n\n`
  );
}

function renderInfeasibleSection(flights, trip, partySize = 1) {
  const { other, prefs } = splitFeasible(flights, trip);
  if (!other.length) return "";
  let md = `## ⛔ 不推荐（与行程冲突 · 起飞 < ${prefs.minDepartureTime}）\n\n`;
  md += `> D8 将军府后 **${prefs.minDepartureTime}** 前起飞无法衔接，仅供参考。\n\n`;
  md += `| 航班 | 航线 | 价格 | 出发 | 到达 |\n`;
  md += `|------|------|------|------|------|\n`;
  for (const f of other.sort((a, b) => b.depDateTime.localeCompare(a.depDateTime)).slice(0, 8)) {
    const price =
      partySize > 1
        ? `¥${f.priceNum.toFixed(0)}/人 (¥${(f.priceNum * partySize).toFixed(0)})`
        : `¥${f.priceNum.toFixed(0)}`;
    md += `| ${f.flightNo} | ${f.route || ""} | ${price} | ${f.depDateTime?.slice(11, 16)} | ${f.arrDateTime?.slice(11, 16)} |\n`;
  }
  return md + "\n";
}

function renderAdjacentReference(scoredFlights, results) {
  const refs = results.filter((r) => r.adjacentFallback && (r.flights || []).length > 0);
  if (!refs.length) return "";
  let md = `## 📅 相邻日参考（主查询无库存时）\n\n`;
  md += `> 以下日期为 **±1 天** 补充查询，**非目标返程日**，仅供比价与备选。\n\n`;
  for (const r of refs.sort((a, b) => a.date.localeCompare(b.date))) {
    const refDate = r.referenceDate || "—";
    const dayFlights = scoredFlights.filter((f) => f.date === r.date && f.route === r.route);
    const best = dayFlights.sort((a, b) => a.priceNum - b.priceNum)[0];
    md += `- **${r.route} ${r.date}**（相对目标日 ${refDate}）— ${dayFlights.length} 条`;
    if (best) {
      md += `，最低 **${best.flightNo}** ¥${best.priceNum.toFixed(0)} ${best.depDateTime?.slice(11, 16)} 起`;
    }
    md += "\n";
  }
  return md + "\n";
}

module.exports = {
  parseTimeToMinutes,
  getReturnPreferences,
  isFeasibleReturnFlight,
  splitFeasible,
  countMainApiFlights,
  countCustomFlights,
  addDays,
  primaryReturnDates,
  inboundRoutes,
  renderInventoryAlert,
  renderTargetPriceAlert,
  renderInfeasibleSection,
  renderAdjacentReference,
};
