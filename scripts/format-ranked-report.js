#!/usr/bin/env node
/**
 * Score flights and render daily TOP3 with deduction breakdown.
 * Higher score = better. Reads monitor JSONL from stdin.
 */
const fs = require("fs");
const { formatShanghaiTime } = require("./format-time");
const { parseJsonl, buildRouteMap, compactMap, parsePrice: storeParsePrice } = require("./flight-store");
const {
  loadConfig,
  labelCity,
  formatDateRange,
  formatCoverage,
  parseRoute,
  isOutboundRoute,
  isConfiguredMonitorEntry,
  remoteCity,
} = require("./load-monitor-config");
const {
  getProfile,
  timeSlotPoints: profileTimeSlot,
  arrTimeSlotPoints,
  pickScenario,
} = require("./scoring-profiles");
const {
  splitFeasible,
  renderInventoryAlert,
  renderTargetPriceAlert,
  renderInfeasibleSection,
  renderAdjacentReference,
  getReturnPreferences,
} = require("./return-flight-prefs");
const {
  shouldUseReturnOriginScoring,
  getOutboundAnchor,
  depCityPref,
  formatDepCityDeduction,
} = require("./return-origin-scoring");

const CFG = loadConfig();
const ORIGINS = CFG.origins;
const DESTINATIONS = CFG.destinations;
const SCORING = CFG.scoring;
const TOP_N = 3;

const TRIP = CFG.trip || {};
const PARTY_SIZE = TRIP.partySize || 1;
const SCORING_PROFILE = getProfile(
  TRIP.scoringProfile || CFG.scoring?.profile || "default"
);
const WEIGHTS = { ...SCORING_PROFILE.weights };

const DURATION_CAP_8H = 480;
const DURATION_CAP_10H = 600;

function parsePrice(p) {
  return storeParsePrice(p);
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

function xjAirportPref(airport) {
  return SCORING.destinationScores[airport] ?? 100;
}

function isOutbound(route) {
  return isOutboundRoute(route, CFG);
}

function guangdongPref(f, direction) {
  return depCityPref(f, direction, TRIP, SCORING).pts;
}

function transferCount(f) {
  if (f.customTransfer) return 1;
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

function pricePointsAbsolute(price) {
  if (price < 500) return 70;
  if (price < 750) return 85;
  if (price < 1000) return 92;
  const tier = Math.floor(price / 1000);
  return Math.max(0, 100 - tier * 25);
}

function pricePointsRelative(price, dayPrices) {
  if (dayPrices.length < 2) return 100;
  const min = Math.min(...dayPrices);
  const max = Math.max(...dayPrices);
  if (max === min) return 100;
  return Math.round((1 - (price - min) / (max - min)) * 100);
}

function pricePointsCombined(price, dayPrices) {
  const abs = pricePointsAbsolute(price);
  const rel = pricePointsRelative(price, dayPrices);
  return Math.round(abs * 0.5 + rel * 0.5);
}

function dayOf(dt) {
  return dt ? dt.slice(0, 10) : "";
}

function isCrossDayOverall(f) {
  return dayOf(f.depDateTime) !== dayOf(f.arrDateTime);
}

function isCrossDaySegment(f) {
  const segs = f.segments || [];
  for (let i = 0; i < segs.length - 1; i++) {
    if (dayOf(segs[i].arrDateTime) !== dayOf(segs[i + 1].depDateTime)) return true;
  }
  return false;
}

/** Cross-day penalty: API 联程看整体或航段跨日；自定义中转仅看整体到达是否跨日（枢纽隔夜不计入跨日扣分）。 */
function isCrossDayForPenalty(f) {
  if (f.customTransfer) return isCrossDayOverall(f);
  return isCrossDayOverall(f) || isCrossDaySegment(f);
}

function transferScoreBreakdown(f) {
  let basePts = 100;
  if (f.transfers >= 2) basePts = 50;
  else if (f.transfers === 1) basePts = 75;

  const crossDayPenalty = isCrossDayForPenalty(f) ? 25 : 0;
  const customPenalty = f.customTransfer ? 25 : 0;
  const transferPts = Math.max(0, basePts - crossDayPenalty - customPenalty);

  return { transferPts, basePts, crossDayPenalty, customPenalty };
}

function transferPoints(count, f) {
  return transferScoreBreakdown({ ...f, transfers: count }).transferPts;
}

function timeSlotPoints(dateTimeStr) {
  return profileTimeSlot(dateTimeStr, SCORING_PROFILE);
}

function durationPointsFromNorm(normVal, durationMin) {
  let pts = Math.round((1 - normVal) * 100);
  if (durationMin > DURATION_CAP_10H) pts = Math.min(pts, 70);
  else if (durationMin > DURATION_CAP_8H) pts = Math.min(pts, 85);
  return pts;
}

function computeTotalScore(f) {
  return Math.round(
    (
      (f.pricePts / 100) * WEIGHTS.price +
      (f.durationPts / 100) * WEIGHTS.duration +
      (f.transferPts / 100) * WEIGHTS.transfer +
      (f.depPref / 100) * WEIGHTS.depCity +
      (f.depTimePts / 100) * WEIGHTS.depTime +
      (f.arrTimePts / 100) * WEIGHTS.arrTime
    ) * 1000
  ) / 10;
}

function flattenFlights(results) {
  const seen = new Map();
  for (const r of results) {
    for (const f of r.flights || []) {
      const key = `${f.depDateTime}|${f.flightNo}`;
      if (!seen.has(key)) {
        const { origin, dest } = parseRoute(r.route);
        const xjAirport = remoteCity(r.route, CFG);
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
  const dayPrices = flights.map(f => f.priceNum);
  const durations = flights.map(f => f.durationMin);
  const normD = normalize(durations);

  return flights.map((f, i) => {
    const depCityMeta = depCityPref(f, direction, TRIP, SCORING);
    const depPref = depCityMeta.pts;
    const pricePts = pricePointsCombined(f.priceNum, dayPrices);
    const transferBreakdown = transferScoreBreakdown(f);
    const transferPts = transferBreakdown.transferPts;
    const depTimePts = timeSlotPoints(f.depDateTime);
    const arrTimePts = arrTimeSlotPoints(f, SCORING_PROFILE);
    const durationPts = durationPointsFromNorm(normD[i], f.durationMin);
    const xjPref =
      depCityMeta.mode === "return_origin" ? depPref : xjAirportPref(f.xjAirport);
    const row = {
      ...f,
      direction,
      depPref,
      depCityMeta,
      xjPref,
      pricePts,
      transferPts,
      transferBasePts: transferBreakdown.basePts,
      crossDayPenalty: transferBreakdown.crossDayPenalty,
      customPenalty: transferBreakdown.customPenalty,
      depTimePts,
      arrTimePts,
      durationPts,
      crossDay: transferBreakdown.crossDayPenalty > 0,
    };
    row.score = computeTotalScore(row);
    return row;
  }).sort((a, b) => b.score - a.score || a.priceNum - b.priceNum);
}

function scoreFlightsByDay(allFlights, direction) {
  const byDate = new Map();
  for (const f of allFlights) {
    if (!byDate.has(f.date)) byDate.set(f.date, []);
    byDate.get(f.date).push(f);
  }
  const scored = [];
  for (const dayFlights of byDate.values()) {
    scored.push(...scoreFlights(dayFlights, direction));
  }
  return scored;
}

function markPriceReliability(flights) {
  const groups = new Map();
  for (const f of flights) {
    const key = `${f.route}|${f.date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }

  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.priceNum - b.priceNum);
    if (sorted.length >= 2) {
      const low = sorted[0].priceNum;
      const second = sorted[1].priceNum;
      if (second > 0 && low / second < 0.8) {
        sorted[0].priceVerified = false;
        sorted[0].priceWarning =
          `API ¥${low.toFixed(0)} 比同航线次低价 ¥${second.toFixed(0)} 低 ${Math.round((1 - low / second) * 100)}%，与 App 价可能不符`;
      }
    }
    const prices = group.map(f => f.priceNum).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    for (const f of group) {
      if (median > 0 && f.priceNum < median * 0.75) {
        f.priceVerified = false;
        f.priceWarning =
          f.priceWarning ||
          `API ¥${f.priceNum.toFixed(0)} 低于同航线中位价 ¥${median.toFixed(0)}，请以 App 为准`;
      }
    }
  }

  for (const f of flights) {
    const outFloor = SCORING.apiPriceFloor[f.xjAirport];
    const retFloor = SCORING.apiPriceFloorReturn[f.xjAirport] ?? outFloor;
    const isOutToRemote =
      f.direction === "outbound" && ORIGINS.includes(f.origin) && outFloor;
    const isBackFromRemote =
      f.direction === "inbound" && DESTINATIONS.includes(f.xjAirport) && retFloor;

    if (f.customTransfer) {
      if (isOutToRemote && f.leg2PriceNum != null && f.leg2PriceNum < outFloor) {
        f.priceVerified = false;
        f.priceWarning =
          `自定义中转第二段 ${labelCity(f.transitCity)}→${labelCity(f.xjAirport)} API ¥${f.leg2PriceNum.toFixed(0)} 低于参考线 ¥${outFloor}，**已排除在 TOP3 外**`;
      }
      if (isBackFromRemote && f.leg1PriceNum != null && f.leg1PriceNum < retFloor) {
        f.priceVerified = false;
        f.priceWarning =
          `自定义中转第一段 ${labelCity(f.xjAirport)}→${labelCity(f.transitCity)} API ¥${f.leg1PriceNum.toFixed(0)} 低于返程参考线 ¥${retFloor}，**已排除在 TOP3 外**`;
      }
    }

    if (isOutToRemote && f.priceNum < outFloor) {
      f.priceVerified = false;
      f.priceWarning =
        `${f.origin}→${labelCity(f.xjAirport)} API ¥${f.priceNum.toFixed(0)} 低于参考线 ¥${outFloor}，` +
        `联程拆分价常见，App 实价通常更高，**已排除在 TOP3 外**`;
    }
    if (isBackFromRemote && f.priceNum < retFloor) {
      f.priceVerified = false;
      f.priceWarning =
        `${labelCity(f.xjAirport)}→${f.dest} API ¥${f.priceNum.toFixed(0)} 低于返程参考线 ¥${retFloor}，` +
        `联程价可能偏低，**已排除在 TOP3 外**`;
    }
  }

  for (const f of flights) {
    if (f.priceVerified === false) {
      f.pricePts = Math.min(f.pricePts, 50);
      f.score = computeTotalScore(f);
    }
  }

  return flights;
}

function rankCompare(a, b) {
  if (a.priceVerified === false && b.priceVerified !== false) return 1;
  if (b.priceVerified === false && a.priceVerified !== false) return -1;
  return b.score - a.score || a.priceNum - b.priceNum;
}

function pickTopDiverse(flights, n = TOP_N, { ensureCustom = false } = {}) {
  const sorted = [...flights].sort(rankCompare);
  const verified = sorted.filter(f => f.priceVerified !== false);
  const picked = [];
  const usedAirports = new Set();

  for (const f of verified) {
    if (picked.length >= n) break;
    if (!usedAirports.has(f.xjAirport)) {
      picked.push(f);
      usedAirports.add(f.xjAirport);
    }
  }
  for (const f of verified) {
    if (picked.length >= n) break;
    if (!picked.includes(f)) picked.push(f);
  }
  let result = picked.slice(0, n);

  if (ensureCustom && !result.some(f => f.customTransfer)) {
    const customs = verified.filter(f => f.customTransfer).sort(rankCompare);
    if (customs.length) {
      const used = new Set(result.map(f => f.xjAirport));
      const bestCustom = customs.find(f => !used.has(f.xjAirport)) || customs[0];
      const replaceAt =
        result.findIndex(f => f.xjAirport === bestCustom.xjAirport) >= 0
          ? result.findIndex(f => f.xjAirport === bestCustom.xjAirport)
          : result.length - 1;
      result = [...result];
      result[replaceAt] = bestCustom;
    }
  }

  return result.slice(0, n);
}

function topByDay(flights, n = TOP_N, options = {}) {
  const byDate = new Map();
  for (const f of flights) {
    if (!byDate.has(f.date)) byDate.set(f.date, []);
    byDate.get(f.date).push(f);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, list]) => ({
      date,
      flights: pickTopDiverse(list, n, options),
    }));
}

function topByDayPerDest(flights) {
  const byDate = new Map();
  for (const f of flights) {
    if (f.priceVerified === false) continue;
    if (!byDate.has(f.date)) byDate.set(f.date, new Map());
    const destMap = byDate.get(f.date);
    const cur = destMap.get(f.xjAirport);
    if (!cur || rankCompare(f, cur) < 0) destMap.set(f.xjAirport, f);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, destMap]) => ({
      date,
      flights: [...destMap.values()].sort(rankCompare),
    }));
}

function recommendRoundTrips(outbound, inbound, limit = 3) {
  const outs = outbound
    .filter(f => f.priceVerified !== false)
    .sort(rankCompare)
    .slice(0, 8);
  const ins = inbound
    .filter(f => f.priceVerified !== false)
    .sort(rankCompare)
    .slice(0, 8);
  const combos = [];
  for (const o of outs) {
    for (const i of ins) {
      const totalPrice = o.priceNum + i.priceNum;
      const comboScore =
        o.score * 0.45 +
        i.score * 0.45 +
        pricePointsAbsolute(totalPrice) * 0.1;
      combos.push({ outbound: o, inbound: i, totalPrice, comboScore });
    }
  }
  return combos
    .sort((a, b) => b.comboScore - a.comboScore || a.totalPrice - b.totalPrice)
    .slice(0, limit);
}

function routeDisplay(f) {
  const d = labelCity(f.dest);
  const o = labelCity(f.origin);
  return `${f.origin === o ? f.origin : o}→${f.dest === d ? f.dest : d}`;
}

function buildDeductions(f) {
  const items = [];
  const gdCity = f.direction === "outbound" ? f.origin : f.dest;

  if (f.customTransfer) {
    items.push(
      `自定义中转：${labelCity(f.transitCity)} 衔接 ${formatDuration(f.connectionMin)}，` +
        `第一段 ${f.leg1FlightNo || ""} (¥${(f.leg1PriceNum || 0).toFixed(0)}) + ` +
        `第二段 ${f.leg2FlightNo || ""} (¥${(f.leg2PriceNum || 0).toFixed(0)})，需分段购票`
    );
  }

  if (f.priceNum >= 1000) {
    const tier = Math.floor(f.priceNum / 1000);
    items.push(`价格 ¥${f.priceNum.toFixed(0)}：满 ${tier}000 元档，绝对分 ${100 - tier * 25}（综合价分 ${f.pricePts}）`);
  } else if (f.priceNum < 500) {
    items.push(`价格 ¥${f.priceNum.toFixed(0)}：<500 元档（绝对分 70，综合价分 ${f.pricePts}）`);
  } else if (f.priceNum < 750) {
    items.push(`价格 ¥${f.priceNum.toFixed(0)}：500–749 元档（绝对分 85，综合价分 ${f.pricePts}）`);
  } else {
    items.push(`价格 ¥${f.priceNum.toFixed(0)}：750–999 元档（绝对分 92，综合价分 ${f.pricePts}）`);
  }

  if (f.durationPts < 100) {
    items.push(`飞行时长 ${formatDuration(f.durationMin)}：时长分 ${f.durationPts}（相对偏长，最高扣 15% 权重）`);
  } else {
    items.push(`飞行时长 ${formatDuration(f.durationMin)}：时长分 100（当日较短）`);
  }

  if (f.crossDayPenalty > 0 || f.customPenalty > 0) {
    if (f.transfers >= 2) {
      items.push(`转机基础分 ${f.transferBasePts}：转机 ≥2 次 → 50 分`);
    } else if (f.transfers > 0) {
      items.push(`转机基础分 ${f.transferBasePts}：转机 ${f.transfers} 次 → 75 分`);
    } else {
      items.push(`转机基础分 ${f.transferBasePts}：直达 → 100 分`);
    }
    if (f.crossDayPenalty > 0) {
      items.push(`跨日扣分 -${f.crossDayPenalty} → 转机分 ${f.transferBasePts - f.crossDayPenalty}`);
    }
    if (f.customPenalty > 0) {
      items.push(`自定义中转扣分 -${f.customPenalty} → 转机分 ${f.transferPts}`);
    }
    items.push(`转机分合计 ${f.transferPts}`);
  } else if (f.transfers >= 2) {
    items.push(`转机分 ${f.transferPts}：转机 ≥2 次 → 50 分`);
  } else if (f.transfers > 0) {
    items.push(`转机分 ${f.transferPts}：转机 1 次 → 75 分`);
  } else {
    items.push(`转机分 ${f.transferPts}：直达且当日到达（满分）`);
  }

  if (f.depCityMeta) {
    items.push(formatDepCityDeduction(f.depCityMeta, labelCity));
  } else if (f.depPref < 100) {
    items.push(`出发/到达地 ${gdCity}：偏好分 80（较深圳 100 扣 20）`);
  } else {
    items.push(`出发/到达地 ${gdCity}：偏好分 100`);
  }

  if (f.depTimePts < 100) {
    items.push(`起飞 ${f.depDateTime.slice(11, 16)}：非理想时段（07–10 / 10–20 最佳），${f.depTimePts} 分`);
  }
  if (f.arrTimePts < 100) {
    items.push(`落地 ${f.arrDateTime.slice(11, 16)}：非理想时段，${f.arrTimePts} 分`);
  }

  if (f.priceVerified === false && f.priceWarning) {
    items.push(`⚠️ 价格可信度：${f.priceWarning}`);
  }

  return items;
}

function renderScoringGuide() {
  const w = WEIGHTS;
  const anchor = getOutboundAnchor(TRIP);
  const useReturnOrigin = shouldUseReturnOriginScoring(TRIP, "inbound");
  const depCityRule = useReturnOrigin
    ? `去程已订 → **返程新疆出发地**相对去程目的地 **${labelCity(anchor)}** 远近（同机场 100，其他按 \`returnOriginScoresByAnchor\` 扣减）`
    : "可配置（默认深圳 100、广州 80）";
  const anchorTable =
    useReturnOrigin && SCORING.returnOriginScoresByAnchor?.[anchor]
      ? Object.entries(SCORING.returnOriginScoresByAnchor[anchor])
          .sort((a, b) => b[1] - a[1])
          .map(([ap, pts]) => `${labelCity(ap)} ${pts}`)
          .join(" · ")
      : "";
  return `## 📐 评分标准说明（v2 · ${SCORING_PROFILE.label}）

综合分 **越高越好**，满分 100。**按日期分组**评分（同日航班互相比较时长/价格）。
${PARTY_SIZE > 1 ? `\n> 团队人数：**${PARTY_SIZE} 人**（表格单价 × ${PARTY_SIZE} = 合计）\n` : ""}

| 维度 | 权重 | 计分规则 |
|------|------|----------|
| 机票价格 | ${Math.round(w.price * 100)}% | 绝对档（<500→70，500–749→85，750–999→92，¥1000+ 每档-25）与**当日相对价**各 50% 加权 |
| 飞行时长 | ${Math.round(w.duration * 100)}% | 同日内归一化；>8h 封顶 85 分，>10h 封顶 70 分 |
| 转机（基础） | ${Math.round(w.transfer * 100)}% | 直达 100；1 次 75；≥2 次 50 |
| 跨日扣分 | （转机维度内） | 整体到达跨日 **-25**（API 联程含航段跨日；自定义中转仅看整体到达日） |
| 自定义中转扣分 | （转机维度内） | 分段购票方案 **-25**，与跨日扣分**独立叠加** |
| 出发/到达地 | ${Math.round(w.depCity * 100)}% | ${depCityRule} |
| 起飞时间 | ${Math.round(w.depTime * 100)}% | 画像 ${SCORING_PROFILE.label} 时段偏好 |
| 落地时间 | ${Math.round(w.arrTime * 100)}% | 同起飞；老人画像次日上午到达加分 |
${anchorTable ? `\n> 返程出发地分（锚点 ${labelCity(anchor)}）：${anchorTable}\n` : ""}

**公式：** 综合分 = Σ(子分 ÷ 100 × 权重) × 100

**TOP3 规则：** 优先覆盖不同目的地；API 联程与自定义中转**统一按综合分排序**；不可信 API 低价不参与排名且价格分封顶 50。

**自定义中转：** 固定枢纽 ${(CFG.customTransfer?.transferHubs || ["西安", "兰州"]).join("/")}，按 leg1+leg2 估价排序；返程**始终**查询自定义中转，去程主查询已有 ≥${CFG.customTransfer?.trigger?.maxMainResults ?? CFG.customTransfer?.skipIfMainResultsAtLeast ?? 3} 条时跳过；衔接 ${CFG.customTransfer?.minConnectionMinutes ?? 90}–${CFG.customTransfer?.maxConnectionMinutes ?? 480} 分钟；次日 leg2 仅在晚到或当日无衔接时查询。转机评分中**跨日 -25** 与 **自定义 -25** 分开计算、可叠加。

### ⚠️ 关于 API 价格

1. 低于同航线中位价 75% 或低于次低价 20% → 不可信
2. 去程→伊宁/阿勒泰低于参考线、返程←伊宁/阿勒泰低于返程参考线 → 排除 TOP3
3. 链接跳转后请以 **App/网页实际价格** 为准

`;
}

function renderBookingLinks(f) {
  if (f.customTransfer && f.leg1JumpUrl && f.leg2JumpUrl) {
    return `   - 第一段 [预订](${f.leg1JumpUrl}) | 第二段 [预订](${f.leg2JumpUrl})（分段购票，无联程保障）\n\n`;
  }
  return `   - [点击预订](${f.jumpUrl || "#"})\n\n`;
}

function renderDailySections(days, title, direction) {
  let md = `## ${title}\n\n`;
  if (!days.length) return md + "暂无数据\n\n";
  const col1 = direction === "outbound" ? "出发地" : "新疆出发";
  const col2 = direction === "outbound" ? "目的地" : "到达地";
  for (const { date, flights } of days) {
    md += `### ${date.slice(5)}（${date}）\n\n`;
    if (!flights.length) {
      md += "暂无航班\n\n";
      continue;
    }
    md += `| 排名 | 评分 | ${col1} | ${col2} | 航线 | 航班 | 类型 | 价格 | 价格分 | 时长 | 转机分 | 出发 | 到达 |\n`;
    md += "|------|------|--------|--------|------|------|------|------|--------|------|--------|------|------|\n";
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
      const priceTag = f.priceVerified === false ? " ⚠️" : "";
      const typeLabel = f.customTransfer
        ? `自定义中转(${labelCity(f.transitCity)})`
        : f.journeyType;
      md += `| ${i + 1} | ${f.score} | ${c1} | ${c2} | ${routeDisplay(f)} | ${f.flightNo} | ${typeLabel} | ¥${f.priceNum.toFixed(0)}${priceTag}${PARTY_SIZE > 1 ? ` / ¥${(f.priceNum * PARTY_SIZE).toFixed(0)}` : ""} | ${f.pricePts} | ${formatDuration(f.durationMin)} | ${f.transferPts} | ${f.depDateTime.slice(11, 16)} | ${f.arrDateTime.slice(11, 16)} |\n`;
    });
    md += "\n**扣分项明细：**\n\n";
    flights.forEach((f, i) => {
      md += `${i + 1}. **${routeDisplay(f)} ${f.flightNo}**（综合 ${f.score}）\n`;
      for (const line of buildDeductions(f)) md += `   - ${line}\n`;
      md += renderBookingLinks(f);
    });
  }
  return md;
}

function renderPerDestTop1(days, title) {
  let md = `## ${title}\n\n`;
  if (!days.length) return md + "暂无数据\n\n";
  for (const { date, flights } of days) {
    md += `### ${date.slice(5)}（${date}）\n\n`;
    if (!flights.length) {
      md += "暂无航班\n\n";
      continue;
    }
    md += "| 目的地 | 评分 | 航线 | 航班 | 价格 | 出发 | 到达 |\n";
    md += "|--------|------|------|------|------|------|------|\n";
    for (const f of flights) {
      md += `| ${labelCity(f.xjAirport)} | ${f.score} | ${routeDisplay(f)} | ${f.flightNo} | ¥${f.priceNum.toFixed(0)} | ${f.depDateTime.slice(11, 16)} | ${f.arrDateTime.slice(11, 16)} |\n`;
    }
    md += "\n";
  }
  return md;
}

function renderRoundTrips(combos) {
  let md = `## 🔄 推荐往返组合 TOP3\n\n`;
  md += `综合去程/返程评分（各 45%）与往返总价（10%），仅含可信价格航班。\n\n`;
  if (!combos.length) return md + "暂无组合推荐\n\n";
  combos.forEach((c, i) => {
    const o = c.outbound;
    const n = c.inbound;
    md += `${i + 1}. **¥${c.totalPrice.toFixed(0)}**（组合分 ${c.comboScore.toFixed(1)}）\n`;
    const oTag = c.outbound.customTransfer ? " [自定义中转]" : "";
    const nTag = c.inbound.customTransfer ? " [自定义中转]" : "";
    md += `   - 去 ${o.date} ${routeDisplay(o)} ${o.flightNo} ¥${o.priceNum.toFixed(0)}（${o.score} 分）${oTag}\n`;
    md += `   - 回 ${n.date} ${routeDisplay(n)} ${n.flightNo} ¥${n.priceNum.toFixed(0)}（${n.score} 分）${nTag}\n\n`;
  });
  return md;
}

function renderScenarioPicks(inbound) {
  const dates = TRIP.returnDateCompare?.length ? TRIP.returnDateCompare : [];
  if (!dates.length) return "";
  let md = `## 👨‍👩‍👧 返程场景推荐（${SCORING_PROFILE.label}）\n\n`;
  md += `| 日期 | 场景 | 航班 | 单价 | ${PARTY_SIZE}人合计 | 出发→到达 |\n`;
  md += `|------|------|------|------|-----------|----------|\n`;
  for (const d of dates) {
    const dayFlights = inbound.filter((f) => f.date === d && f.priceVerified !== false);
    const scenarios = [
      ["最低价", pickScenario(dayFlights, "cheapest", SCORING_PROFILE)],
      ["老人友好", pickScenario(dayFlights, "elder", SCORING_PROFILE)],
      ["当日到达", pickScenario(dayFlights, "same_day", SCORING_PROFILE)],
    ];
    for (const [label, f] of scenarios) {
      if (!f) continue;
      md += `| ${d.slice(5)} | ${label} | ${f.flightNo} | ¥${f.priceNum.toFixed(0)} | ¥${(f.priceNum * PARTY_SIZE).toFixed(0)} | ${f.depDateTime.slice(11, 16)}→${f.arrDateTime.slice(11, 16)} |\n`;
    }
  }
  return md + "\n";
}

function renderExcludedFlights(flights, limit = 8) {
  const bad = flights.filter(f => f.priceVerified === false);
  if (!bad.length) return "";
  let md = `## ⚠️ 已排除的不可信低价（节选）\n\n`;
  for (const f of bad.sort((a, b) => a.priceNum - b.priceNum).slice(0, limit)) {
    md += `- ${f.date} ${routeDisplay(f)} ${f.flightNo} ¥${f.priceNum.toFixed(0)}：${f.priceWarning || "价格不可信"}\n`;
  }
  md += "\n";
  return md;
}

function parseReportArgs(argv) {
  const positional = [];
  let scope = "all";
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--scope" && argv[i + 1]) {
      scope = argv[++i];
      continue;
    }
    positional.push(argv[i]);
  }
  if (!["all", "outbound", "return"].includes(scope)) {
    throw new Error(`Invalid --scope ${scope} (use all|outbound|return)`);
  }
  return { scope, inputPath: positional[0] || 0 };
}

const { scope, inputPath } = parseReportArgs(process.argv);
const raw = fs.readFileSync(inputPath, "utf8");
const results = compactMap(buildRouteMap(parseJsonl(raw))).filter(
  (r) => isConfiguredMonitorEntry(r, CFG) || r.adjacentFallback
);
const all = flattenFlights(results);
const outboundScored = scoreFlightsByDay(all.filter(f => isOutbound(f.route)), "outbound");
const inboundScored = scoreFlightsByDay(all.filter(f => !isOutbound(f.route)), "inbound");
const outbound = markPriceReliability(outboundScored);
const inbound = markPriceReliability(inboundScored);
const customOutCount = outbound.filter(f => f.customTransfer).length;
const customInCount = inbound.filter(f => f.customTransfer).length;

const outByDay = topByDay(outbound);
const { feasible: inboundFeasible } = splitFeasible(inbound, TRIP);
const inByDay = topByDay(inboundFeasible, TOP_N, { ensureCustom: true });
const outPerDest = topByDayPerDest(outbound);
const inPerDest = topByDayPerDest(inboundFeasible);
const roundTrips = recommendRoundTrips(outbound, inboundFeasible);
const returnPrefs = getReturnPreferences(TRIP);

const scopeLabel =
  scope === "outbound" ? "去程" : scope === "return" ? "返程" : "往返";
let md = `# ✈️ ${CFG.routeLabel} ${scopeLabel} TOP3 评分推荐\n\n`;
md += `> 生成时间：${formatShanghaiTime()} (Asia/Shanghai)\n\n`;
md += `> 覆盖目的地：${formatCoverage(DESTINATIONS)}\n\n`;
if (scope === "outbound") {
  md += `- 去程：${formatDateRange(CFG.outboundDates)}\n`;
} else if (scope === "return") {
  md += `- 返程：${formatDateRange(CFG.returnDates)}\n`;
} else {
  md += `- 去程：${formatDateRange(CFG.outboundDates)} | 返程：${formatDateRange(CFG.returnDates)}\n`;
}
const showOut = scope === "all" || scope === "outbound";
const showIn = scope === "all" || scope === "return";
if (showOut) {
  md += `- 候选航班：去程 ${outbound.length} 条`;
  if (customOutCount > 0) md += `（含自定义中转 ${customOutCount} 条）`;
  md += `\n`;
}
if (showIn && scope === "all") {
  md += `- 候选航班：返程 ${inbound.length} 条`;
  if (customInCount > 0) md += `（含自定义中转 ${customInCount} 条）`;
  md += `\n`;
} else if (showIn && scope === "return") {
  md += `- 候选航班：返程 ${inbound.length} 条（可行窗口 ≥${returnPrefs.minDepartureTime}：**${inboundFeasible.length}** 条）`;
  if (customInCount > 0) md += `（含自定义中转 ${customInCount} 条）`;
  md += `\n`;
}
md += `\n`;

if (showIn) {
  md += renderInventoryAlert(results, TRIP, CFG);
  md += renderTargetPriceAlert(inbound.filter((f) => f.priceVerified !== false), TRIP, PARTY_SIZE);
  if (scope === "return" || scope === "all") {
    md += `> 返程可行窗口：伊宁起飞 ≥ **${returnPrefs.minDepartureTime}**（D8 将军府后）\n\n`;
  }
}

md += renderScoringGuide();
if (showOut) {
  md += renderDailySections(outByDay, "🛫 去程每日 TOP3（目的地多样化）", "outbound");
  md += renderPerDestTop1(outPerDest, "🗺️ 去程各目的地 TOP1");
}
if (showIn) {
  md += renderDailySections(inByDay, "🛬 返程每日 TOP3（可行窗口内 · 目的地多样化）", "inbound");
  md += renderPerDestTop1(inPerDest, "🗺️ 返程各目的地 TOP1（可行窗口内）");
  md += renderScenarioPicks(inboundFeasible);
  md += renderInfeasibleSection(inbound.filter((f) => f.priceVerified !== false), TRIP, PARTY_SIZE);
  md += renderAdjacentReference(inbound, results);
}
if (scope === "all") {
  md += renderRoundTrips(roundTrips);
}
const excludedPool = [
  ...(showOut ? outbound : []),
  ...(showIn ? inbound : []),
];
md += renderExcludedFlights(excludedPool);

md += `---\n基于飞猪 fly.ai 实时数据\n`;
process.stdout.write(md);
