#!/usr/bin/env node
/**
 * Score flights and render daily TOP3 with deduction breakdown.
 * Higher score = better. Reads monitor JSONL from stdin.
 */
const fs = require("fs");
const { formatShanghaiTime } = require("./format-time");
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
const ORIGINS = CFG.origins;
const DESTINATIONS = CFG.destinations;
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

/** 深圳→伊宁/阿勒泰：API 联程价常低于 App，低于此阈值标记不可信 */
const API_PRICE_FLOOR = {
  伊宁: 750,
  阿勒泰: 750,
};

function parseJsonl(raw) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "{") { if (depth === 0) start = i; depth++; }
    else if (raw[i] === "}") { depth--; if (depth === 0) parts.push(raw.slice(start, i + 1)); }
  }
  return parts.map(p => JSON.parse(p));
}

function xjAirportPref(airport) {
  return PREF.xjAirport[airport] ?? PREF.xjAirport.default;
}

function isOutbound(route) {
  return isOutboundRoute(route, CFG);
}

function guangdongPref(f, direction) {
  const { origin, dest } = parseRoute(f.route);
  const city = direction === "outbound" ? origin : dest;
  return PREF.guangdong[city] ?? 80;
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

function pricePoints(price) {
  if (price < 1000) return 100;
  const tier = Math.floor(price / 1000);
  return Math.max(0, 100 - tier * 25);
}

function dayOf(dt) {
  return dt ? dt.slice(0, 10) : "";
}

function isCrossDay(f) {
  if (dayOf(f.depDateTime) !== dayOf(f.arrDateTime)) return true;
  const segs = f.segments || [];
  for (let i = 0; i < segs.length - 1; i++) {
    if (dayOf(segs[i].arrDateTime) !== dayOf(segs[i + 1].depDateTime)) return true;
  }
  return false;
}

function transferPoints(count, f) {
  let pts = Math.max(0, 100 - count * 25);
  if (isCrossDay(f)) pts = Math.max(0, pts - 25);
  return pts;
}

function timeSlotPoints(dateTimeStr) {
  const hour = parseInt(dateTimeStr.slice(11, 13), 10);
  return hour >= 7 && hour <= 22 ? 100 : 80;
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
  const durations = flights.map(f => f.durationMin);
  const normD = normalize(durations);

  return flights.map((f, i) => {
    const depPref = guangdongPref(f, direction);
    const xjPref = xjAirportPref(f.xjAirport);
    const pricePts = pricePoints(f.priceNum);
    const transferPts = transferPoints(f.transfers, f);
    const depTimePts = timeSlotPoints(f.depDateTime);
    const arrTimePts = timeSlotPoints(f.arrDateTime);
    const durationPts = Math.round((1 - normD[i]) * 100);
    const score =
      (pricePts / 100) * WEIGHTS.price +
      (durationPts / 100) * WEIGHTS.duration +
      (transferPts / 100) * WEIGHTS.transfer +
      (depPref / 100) * WEIGHTS.depCity +
      (xjPref / 100) * WEIGHTS.xjAirport +
      (depTimePts / 100) * WEIGHTS.depTime +
      (arrTimePts / 100) * WEIGHTS.arrTime;
    return {
      ...f,
      direction,
      depPref,
      xjPref,
      pricePts,
      transferPts,
      depTimePts,
      arrTimePts,
      durationPts,
      crossDay: isCrossDay(f),
      score: Math.round(score * 1000) / 10,
    };
  }).sort((a, b) => b.score - a.score || a.priceNum - b.priceNum);
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
    if (f.origin !== "深圳") continue;
    const floor = API_PRICE_FLOOR[f.xjAirport];
    if (!floor) continue;
    if (f.priceNum < floor) {
      f.priceVerified = false;
      f.priceWarning =
        `深圳→${labelCity(f.xjAirport)} API ¥${f.priceNum.toFixed(0)} 低于参考线 ¥${floor}，` +
        `联程拆分价常见，App 实价通常更高，**已排除在 TOP3 外**`;
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

function buildDeductions(f) {
  const items = [];
  const gdCity = f.direction === "outbound" ? f.origin : f.dest;

  if (f.priceNum >= 1000) {
    const tier = Math.floor(f.priceNum / 1000);
    items.push(`价格 ¥${f.priceNum.toFixed(0)}：满 ${tier}000 元档，价格分 ${100 - tier * 25}（扣 ${tier * 25}）`);
  } else {
    items.push(`价格 ¥${f.priceNum.toFixed(0)}：1000 以下，价格分 100（满分）`);
  }

  if (f.durationPts < 100) {
    items.push(`飞行时长 ${formatDuration(f.durationMin)}：时长分 ${f.durationPts}（相对偏长，最高扣 15% 权重）`);
  } else {
    items.push(`飞行时长 ${formatDuration(f.durationMin)}：时长分 100（当日较短）`);
  }

  const transferParts = [];
  if (f.transfers > 0) transferParts.push(`转机 ${f.transfers} 次 -${f.transfers * 25}`);
  if (f.crossDay) transferParts.push(`跨天/航段跨日 -25`);
  if (transferParts.length) {
    items.push(`转机分 ${f.transferPts}：${transferParts.join("，")}`);
  } else {
    items.push(`转机分 100：直达且当日到达（满分）`);
  }

  if (f.depPref < 100) {
    items.push(`出发/到达地 ${gdCity}：偏好分 80（较深圳 100 扣 20）`);
  } else {
    items.push(`出发/到达地 ${gdCity}：偏好分 100`);
  }

  if (f.depTimePts < 100) {
    items.push(`起飞 ${f.depDateTime.slice(11, 16)}：不在 07:00–22:00，扣 20`);
  }
  if (f.arrTimePts < 100) {
    items.push(`落地 ${f.arrDateTime.slice(11, 16)}：不在 07:00–22:00，扣 20`);
  }

  if (f.priceVerified === false && f.priceWarning) {
    items.push(`⚠️ 价格可信度：${f.priceWarning}`);
  }

  return items;
}

function renderScoringGuide() {
  return `## 📐 评分标准说明

综合分 **越高越好**，满分 100。各维度先换算为 0–100 的子分，再按权重加权：

| 维度 | 权重 | 计分规则 |
|------|------|----------|
| 机票价格 | 25% | ¥1000 以下 100 分；每增加 ¥1000 减 25 分（¥1000–1999→75，¥2000–2999→50…） |
| 飞行时长 | 15% | 同批次候选航班内归一化：越短越高（0=最长，100=最短） |
| 转机 | 15% | 0 次 100；每多 1 次 -25；全程或航段间跨日再 -25 |
| 出发/到达地 | 10% | 深圳 100；广州 80 |
| 新疆机场 | 10% | 乌鲁木齐/伊宁/阿勒泰/石河子均为 100 |
| 起飞时间 | 12.5% | 07:00–22:00 为 100；其余 80 |
| 落地时间 | 12.5% | 07:00–22:00 为 100；其余 80 |

**公式：** 综合分 = Σ(子分 ÷ 100 × 权重) × 100

### ⚠️ 关于 API 价格

飞猪 API 对 **深圳→伊宁/阿勒泰** 等联程航线，常返回低于手机 App 的拆分价/缓存价。本报告会：

1. 低于同航线中位价 75% 或低于次低价 20% 的报价标记为不可信
2. 深圳→伊宁/阿勒泰低于 **¥750** 的报价自动标记并 **不参与 TOP3 排名**
3. 链接跳转后请以 **App/网页实际价格** 为准

`;
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
      md += `| ${i + 1} | ${f.score} | ${c1} | ${c2} | ${routeDisplay(f)} | ${f.flightNo} | ${f.journeyType} | ¥${f.priceNum.toFixed(0)}${priceTag} | ${f.pricePts} | ${formatDuration(f.durationMin)} | ${f.transferPts} | ${f.depDateTime.slice(11, 16)} | ${f.arrDateTime.slice(11, 16)} |\n`;
    });
    md += "\n**扣分项明细：**\n\n";
    flights.forEach((f, i) => {
      md += `${i + 1}. **${routeDisplay(f)} ${f.flightNo}**（综合 ${f.score}）\n`;
      for (const line of buildDeductions(f)) md += `   - ${line}\n`;
      md += `   - [点击预订](${f.jumpUrl || "#"})\n\n`;
    });
  }
  return md;
}

const raw = fs.readFileSync("/dev/stdin", "utf8");
const results = parseJsonl(raw);
const all = flattenFlights(results);
const outbound = markPriceReliability(
  scoreFlights(all.filter(f => isOutbound(f.route)), "outbound")
);
const inbound = markPriceReliability(
  scoreFlights(all.filter(f => !isOutbound(f.route)), "inbound")
);

const outByDay = topByDay(outbound);
const inByDay = topByDay(inbound);

let md = `# ✈️ ${CFG.routeLabel} 每日 TOP3 评分推荐\n\n`;
md += `> 生成时间：${formatShanghaiTime()} (Asia/Shanghai)\n\n`;
md += `> 覆盖目的地：${formatCoverage(DESTINATIONS)}\n\n`;
md += `- 去程：${formatDateRange(CFG.outboundDates)} | 返程：${formatDateRange(CFG.returnDates)}\n`;
md += `- 候选航班：去程 ${outbound.length} 条，返程 ${inbound.length} 条\n\n`;

md += renderScoringGuide();
md += renderDailySections(outByDay, "🛫 去程每日 TOP3", "outbound");
md += renderDailySections(inByDay, "🛬 返程每日 TOP3", "inbound");

md += `---\n基于飞猪 fly.ai 实时数据\n`;
process.stdout.write(md);
