/**
 * Return flight preferences (phase 2) vs itinerary constraints (phase 3).
 *
 * Phase 2 — return ranking: price/score only; do NOT filter TOP3 by D8 将军府 etc.
 * Phase 3 — travel plan: optional itineraryConflict advisory from itineraryConstraints.
 */
const { parseRoute } = require("./load-monitor-config");
const { resolveWorkflowState } = require("./trip-workflow");

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
    targetPricePerPerson: p.targetPricePerPerson > 0 ? p.targetPricePerPerson : null,
    adjacentDayFallback: p.adjacentDayFallback !== false,
    /** Explicit opt-in only; default false — return phase ranks all credible flights */
    filterTop3ByItinerary: p.filterTop3ByItinerary === true,
    note: p.note || "",
  };
}

function getItineraryConstraints(trip) {
  const ic = trip?.itineraryConstraints || {};
  return {
    byDate: ic.byDate || {},
    note: ic.note || "",
  };
}

function minDepartureForDate(trip, date) {
  const row = getItineraryConstraints(trip).byDate?.[date];
  return row?.minDepartureTime || null;
}

function shouldFilterTop3ByItinerary(trip) {
  return getReturnPreferences(trip).filterTop3ByItinerary;
}

function isFeasibleForItinerary(f, trip) {
  const min = minDepartureForDate(trip, f?.date);
  if (!min) return true;
  const dep = depMinutes(f);
  const minM = parseTimeToMinutes(min);
  if (minM == null || dep == null) return true;
  return dep >= minM;
}

/** @deprecated use isFeasibleForItinerary — kept for tests */
function isFeasibleReturnFlight(f, prefs) {
  void prefs;
  return true;
}

function splitByItinerary(flights, trip) {
  const feasible = [];
  const conflict = [];
  for (const f of flights) {
    if (isFeasibleForItinerary(f, trip)) feasible.push(f);
    else conflict.push(f);
  }
  return { feasible, conflict };
}

function splitFeasible(flights, trip) {
  if (!shouldFilterTop3ByItinerary(trip)) {
    return { feasible: flights, other: [], prefs: getReturnPreferences(trip) };
  }
  const { feasible, conflict } = splitByItinerary(flights, trip);
  return { feasible, other: conflict, prefs: getReturnPreferences(trip) };
}

function inboundRankingPool(flights, trip) {
  const verified = flights.filter((f) => f.priceVerified !== false);
  const { feasible } = splitFeasible(verified.length ? verified : flights, trip);
  return feasible.length ? feasible : verified.length ? verified : flights;
}

function shouldShowItineraryAdvisory(trip, context = "ranked") {
  const ic = getItineraryConstraints(trip);
  if (!Object.keys(ic.byDate).length) return false;
  return context === "plan";
}

function renderPhase2Notice(trip) {
  const { currentPhase } = resolveWorkflowState(trip);
  if (currentPhase !== "return") return "";
  return (
    `> **阶段 2（返程机票）：** TOP3 按价格/评分/画像排序，**不**按 D8 行程过滤。` +
    `行程衔接约束见阶段 3 \`skill:plan\`。\n\n`
  );
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
    `> 以下日期主查询无联程结果；请以 App 实价为准或查看「相邻日参考」。\n\n` +
    lines.join("\n") +
    `\n\n`
  );
}

function renderTargetPriceAlert(flights, trip, partySize = 1) {
  const prefs = getReturnPreferences(trip);
  if (!prefs.targetPricePerPerson) return "";
  const verified = flights.filter((f) => f.priceVerified !== false);
  if (!verified.length) return "";
  const best = verified.reduce((a, b) => (a.priceNum < b.priceNum ? a : b));
  if (best.priceNum > prefs.targetPricePerPerson) return "";
  const total = best.priceNum * partySize;
  return (
    `## 🔔 目标价提醒\n\n` +
    `> **${best.flightNo}** ${best.depDateTime?.slice(11, 16)} 起 — **¥${best.priceNum.toFixed(0)}/人**` +
    `（${partySize} 人 ≈ ¥${total.toFixed(0)}）≤ 目标 ¥${prefs.targetPricePerPerson}/人\n\n`
  );
}

function renderItineraryConflictAdvisory(flights, trip, partySize = 1, context = "plan") {
  if (!shouldShowItineraryAdvisory(trip, context)) return "";
  const ic = getItineraryConstraints(trip);
  const { conflict } = splitByItinerary(
    flights.filter((f) => f.priceVerified !== false),
    trip
  );
  if (!conflict.length) return "";

  let md = `## 📋 行程衔接提示（阶段 3 · 不影响返程 TOP3 排名）\n\n`;
  if (ic.note) md += `> ${ic.note}\n\n`;

  const byDate = new Map();
  for (const f of conflict) {
    if (!byDate.has(f.date)) byDate.set(f.date, []);
    byDate.get(f.date).push(f);
  }
  for (const [date, list] of [...byDate.entries()].sort()) {
    const min = minDepartureForDate(trip, date);
    const row = ic.byDate?.[date];
    md += `### ${date.slice(5)}（${date}）起飞早于 **${min}** 的航班\n\n`;
    if (row?.activity) md += `> 当日安排：${row.activity}\n\n`;
    md += `| 航班 | 价格 | 出发 | 到达 |\n|------|------|------|------|\n`;
    for (const f of list.sort((a, b) => a.priceNum - b.priceNum).slice(0, 6)) {
      const price =
        partySize > 1
          ? `¥${f.priceNum.toFixed(0)}/人`
          : `¥${f.priceNum.toFixed(0)}`;
      md += `| ${f.flightNo} | ${price} | ${f.depDateTime?.slice(11, 16)} | ${f.arrDateTime?.slice(11, 16)} |\n`;
    }
    md += "\n";
  }
  return md;
}

/** @deprecated use renderItineraryConflictAdvisory in plan phase only */
function renderInfeasibleSection(flights, trip, partySize = 1) {
  return renderItineraryConflictAdvisory(flights, trip, partySize, "plan");
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
  getItineraryConstraints,
  minDepartureForDate,
  shouldFilterTop3ByItinerary,
  isFeasibleForItinerary,
  isFeasibleReturnFlight,
  splitFeasible,
  splitByItinerary,
  inboundRankingPool,
  shouldShowItineraryAdvisory,
  renderPhase2Notice,
  countMainApiFlights,
  countCustomFlights,
  addDays,
  primaryReturnDates,
  inboundRoutes,
  renderInventoryAlert,
  renderTargetPriceAlert,
  renderItineraryConflictAdvisory,
  renderInfeasibleSection,
  renderAdjacentReference,
};
