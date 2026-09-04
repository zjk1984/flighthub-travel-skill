#!/usr/bin/env node
/**
 * Travel plan: booked outbound + live return flights + hotels + itinerary skeleton.
 *
 * Usage: node format-travel-plan.js [results.jsonl] [--hotels hotels.json] [--out plan.md]
 */
const fs = require("fs");
const path = require("path");
const { formatShanghaiTime } = require("./format-time");
const { parseJsonl, buildRouteMap, compactMap } = require("./flight-store");
const {
  loadConfig,
  formatDateShort,
  isOutboundRoute,
  isConfiguredMonitorEntry,
} = require("./load-monitor-config");
const {
  getProfile,
  pickScenario,
  isSameDayArrival,
} = require("./scoring-profiles");
const {
  getHotelProfile,
  parsePriceNum,
  roomCountForParty,
  scoreHotelsInSegment,
} = require("./hotel-scoring");
const { renderItineraryConflictAdvisory } = require("./return-flight-prefs");

const ROOT = path.join(__dirname, "..");
const CFG = loadConfig();
const TRIP = CFG.trip || {};
const PARTY = TRIP.partySize || 1;
const ROOMS = roomCountForParty(PARTY, TRIP.roomCount);
const PROFILE = getProfile(TRIP.scoringProfile || CFG.scoring?.profile || "default");
const ITIN = TRIP.itinerary || {};

function parseArgs(argv) {
  let inputPath = path.join(ROOT, "reports/xinjiang-results.jsonl");
  let hotelsPath = path.join(ROOT, "reports/xinjiang-hotels-latest.json");
  let outPath = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--hotels" && argv[i + 1]) {
      hotelsPath = argv[++i];
      continue;
    }
    if (argv[i] === "--out" && argv[i + 1]) {
      outPath = argv[++i];
      continue;
    }
    if (!argv[i].startsWith("-")) inputPath = argv[i];
  }
  return { inputPath, hotelsPath, outPath };
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
        priceVerified: f.priceVerified !== false,
      });
    }
  }
  return flights;
}

function fmtTime(dt) {
  if (!dt) return "—";
  return `${dt.slice(5, 10)} ${dt.slice(11, 16)}`;
}

function fmtParty(price) {
  const total = price * PARTY;
  return `¥${price.toFixed(0)}（5人 ¥${total.toFixed(0)}）`;
}

function renderBookedOutbound() {
  const b = TRIP.bookedOutbound;
  if (!b) return "";
  let md = `## 一、航班信息\n\n### 去程（已订，不再监控）\n\n`;
  md += `| 项目 | 内容 |\n|------|------|\n`;
  md += `| 日期 | ${b.date} |\n`;
  md += `| 航班 | **${b.flightNo || "—"}** |\n`;
  md += `| 路线 | ${b.route}${b.depTime ? ` ${b.depTime}` : ""}${b.arrTime ? ` → **${b.arrTime} 落地**` : ""} |\n`;
  if (b.price) md += `| 参考价 | ¥${b.price}（${PARTY}人 ¥${(b.price * PARTY).toFixed(0)}） |\n`;
  md += `| 说明 | ${b.note || "—"} |\n\n`;
  return md;
}

function renderBookedReturn() {
  const b = TRIP.bookedReturn;
  if (!b) return "";
  let md = `### 返程（已订，不再监控）\n\n`;
  md += `| 项目 | 内容 |\n|------|------|\n`;
  md += `| 日期 | ${b.date} |\n`;
  md += `| 航班 | **${b.flightNo || "—"}** |\n`;
  const arrNote = b.arrDate && b.arrDate !== b.date ? `（${b.arrDate} ${b.arrTime} 落地）` : b.arrTime ? ` → **${b.arrTime} 落地**` : "";
  md += `| 路线 | ${b.route}${b.depTime ? ` ${b.depTime}` : ""}${arrNote} |\n`;
  if (b.price) md += `| 参考价 | ¥${b.price}（${PARTY}人 ¥${(b.price * PARTY).toFixed(0)}） |\n`;
  md += `| 说明 | ${b.note || "—"} |\n\n`;
  return md;
}

function renderReturnSection(inboundByDate) {
  if (TRIP.bookedReturn) return renderBookedReturn();
  const dates = TRIP.returnDateCompare?.length
    ? TRIP.returnDateCompare
    : CFG.returnDates;
  if (!dates.length) return "";

  let md = `### 返程（**正式 API 实价 · 待订**）\n\n`;
  for (const d of dates) {
    const list = inboundByDate.get(d) || [];
    const verified = list.map((f) => ({ ...f, priceVerified: f.priceVerified !== false }));
    const cheapest = pickScenario(verified, "cheapest", PROFILE);
    const elder = pickScenario(verified, "elder", PROFILE);
    const sameDay = pickScenario(verified, "same_day", PROFILE);

    md += `#### 返程 ${formatDateShort(d)}\n\n`;
    md += `| 优先级 | 航班 | 出发→到达 | 实价 | ${PARTY}人合计 | 预订 |\n`;
    md += `|--------|------|-----------|------|-----------|------|\n`;

    const rows = [
      { label: "最低", f: cheapest },
      { label: "老人推荐", f: elder },
      { label: "当日到", f: sameDay },
    ];
    const seen = new Set();
    for (const { label, f } of rows) {
      if (!f || seen.has(f.flightNo + f.priceNum)) continue;
      seen.add(f.flightNo + f.priceNum);
      const book = f.jumpUrl ? `[预订](${f.jumpUrl})` : "—";
      const same = isSameDayArrival(f) ? "✓" : "次日";
      md += `| ${label} | **${f.flightNo}** | ${fmtTime(f.depDateTime)}→${fmtTime(f.arrDateTime)} (${same}) | **¥${f.priceNum.toFixed(0)}** | **¥${(f.priceNum * PARTY).toFixed(0)}** | ${book} |\n`;
    }
    md += "\n";
  }

  if (dates.length >= 2) {
    const p0 = pickScenario(
      (inboundByDate.get(dates[0]) || []).map((f) => ({ ...f, priceVerified: f.priceVerified !== false })),
      "cheapest",
      PROFILE
    );
    const p1 = pickScenario(
      (inboundByDate.get(dates[1]) || []).map((f) => ({ ...f, priceVerified: f.priceVerified !== false })),
      "cheapest",
      PROFILE
    );
    if (p0 && p1) {
      const diff = (p1.priceNum - p0.priceNum) * PARTY;
      const cmp = diff < 0 ? "便宜" : diff > 0 ? "贵" : "相同";
      md += `> **日期对比：** ${formatDateShort(dates[1])} 比 ${formatDateShort(dates[0])} ${cmp}约 **¥${Math.abs(diff).toFixed(0)}**（${PARTY}人合计）\n\n`;
    }
  }
  return md;
}

function pickHotelForPlan(scored, hotelProfile) {
  if (!scored.length) return null;
  if (hotelProfile?.elderFriendly) {
    const comfy = scored.filter((h) => h.comfortPts >= 78);
    if (comfy.length) return comfy[0];
  }
  return scored[0];
}

function loadHotelsBySegment(hotelsPath) {
  if (!fs.existsSync(hotelsPath)) return new Map();
  const raw = JSON.parse(fs.readFileSync(hotelsPath, "utf8")).map((h) => ({
    ...h,
    priceNum: h.priceNum != null ? h.priceNum : parsePriceNum(h.price),
    reviewScore: h.reviewScore ?? h.score ?? null,
  }));
  const hotelProfile = getHotelProfile(TRIP.scoringProfile || "family_elder");
  const bySegment = new Map();
  for (const seg of TRIP.hotels || []) {
    const list = raw.filter((h) => h.segment === seg.segment);
    if (!list.length) continue;
    const scored = scoreHotelsInSegment(list, hotelProfile, seg, PARTY, TRIP.roomCount);
    const pick = pickHotelForPlan(scored, hotelProfile);
    if (pick) bySegment.set(seg.segment, { pick, seg });
  }
  return bySegment;
}

function segmentForDate(dateStr) {
  for (const seg of TRIP.hotels || []) {
    if (dateStr >= seg.checkIn && dateStr < seg.checkOut) return seg.segment;
    if (dateStr === seg.checkIn) return seg.segment;
  }
  return null;
}

function renderItinerary(hotelsBySegment) {
  const days = ITIN.days || [];
  if (!days.length) return "";

  let md = `## 三、7 日慢节奏行程\n\n`;
  if (ITIN.principles?.length) {
    md += `原则：${ITIN.principles.join("；")}。\n\n`;
  }
  if (ITIN.overview) md += `\`\`\`\n${ITIN.overview}\n\`\`\`\n\n`;

  md += `| 日期 | 安排 | 车程 | 住宿推荐 |\n|------|------|------|----------|\n`;
  for (const day of days) {
    const segKey = segmentForDate(day.date);
    let stay = day.stay || "—";
    if (segKey && hotelsBySegment.has(segKey)) {
      const { pick } = hotelsBySegment.get(segKey);
      const book = pick.url ? `[${pick.name}](${pick.url})` : pick.name;
      stay = `${book} ¥${pick.priceNum}/晚`;
    }
    md += `| **${day.label}** | ${day.activity} | ${day.drive || "—"} | ${stay} |\n`;
  }
  md += "\n";

  if (ITIN.skip?.length) {
    md += `### 刻意跳过\n\n`;
    for (const s of ITIN.skip) md += `- **${s.split("（")[0]}** — ${s.includes("（") ? s.split("（")[1].replace("）", "") : s}\n`;
    md += "\n";
  }
  return md;
}

function renderCarRental() {
  const c = ITIN.carRental;
  if (!c) return "";
  let md = `## 二、租车\n\n| 项目 | 建议 |\n|------|------|\n`;
  md += `| 车型 | **${c.type || "7 座 SUV/MPV"}** |\n`;
  md += `| 取还 | **${c.pickup || "—"} → ${c.return || "—"}** |\n`;
  if (c.costPerDay?.length === 2) {
    md += `| 费用 | ¥${c.costPerDay[0]}–${c.costPerDay[1]}/天 × 7 天 ≈ **¥${c.costPerDay[0] * 7}–${c.costPerDay[1] * 7}** |\n`;
  }
  if (c.tips?.length) md += `| 注意 | ${c.tips.join("、")} |\n`;
  md += "\n---\n\n";
  return md;
}

function renderHotelTable(hotelsBySegment) {
  if (!hotelsBySegment.size) return "";
  let md = `## 四、酒店（${PARTY} 人 · **${ROOMS} 间**，**正式实价**）\n\n`;
  md += `| 日期段 | 推荐 | 实价/晚 | 段合计 | 预订 |\n|--------|------|---------|--------|------|\n`;
  for (const [, { pick, seg }] of hotelsBySegment) {
    const range = `${seg.checkIn.slice(5)}→${seg.checkOut.slice(5)}`;
    const book = pick.url ? `[预订](${pick.url})` : "—";
    md += `| ${seg.segment} (${range}) | **${pick.name}** | ¥${pick.priceNum} | ¥${pick.stayTotal?.toFixed(0) || "—"} | ${book} |\n`;
  }
  md += `\n> 完整 TOP3 与评分明细：\`reports/xinjiang-hotels-ranked.md\`\n\n---\n\n`;
  return md;
}

function renderTips() {
  const t = ITIN.tips;
  if (!t) return "";
  let md = `## 五、老人 + 小孩提示\n\n`;
  if (t.elder) md += `**老人：** ${t.elder}\n\n`;
  if (t.teen) md += `**14 岁：** ${t.teen}\n\n`;
  if (t.family) md += `**全家：** ${t.family}\n\n---\n\n`;
  return md;
}

function renderBudget(inboundByDate, hotelsBySegment) {
  const dates = TRIP.returnDateCompare || CFG.returnDates;
  let retLow = null;
  let retHigh = null;
  for (const d of dates) {
    const list = inboundByDate.get(d) || [];
    const verified = list.filter((f) => f.priceVerified !== false);
    const prices = verified.map((f) => f.priceNum * PARTY).sort((a, b) => a - b);
    if (prices.length) {
      retLow = retLow == null ? prices[0] : Math.min(retLow, prices[0]);
      retHigh = retHigh == null ? prices[prices.length - 1] : Math.max(retHigh, prices[prices.length - 1]);
    }
  }
  let hotelTotal = 0;
  for (const [, { pick }] of hotelsBySegment) {
    hotelTotal += pick.stayTotal || pick.priceNum * (pick.nights || 1) * ROOMS;
  }
  const car = ITIN.carRental?.costPerDay;
  const carLow = car ? car[0] * 7 : 3500;
  const carHigh = car ? car[1] * 7 : 5000;

  let md = `## 六、预算粗算（${PARTY} 人，**不含已订去程**）\n\n`;
  md += `| 项目 | 金额 |\n|------|------|\n`;
  if (retLow != null) md += `| 返程机票 | ¥${retLow.toFixed(0)}–${retHigh?.toFixed(0) || "—"} |\n`;
  md += `| 租车 7 天 | ¥${carLow}–${carHigh} |\n`;
  md += `| 油费+过路 | ¥1500–1800 |\n`;
  if (hotelTotal) md += `| 住宿（推荐合计） | ≈ ¥${hotelTotal.toFixed(0)} |\n`;
  else md += `| 住宿 7 晚 | ¥5600–9000 |\n`;
  md += `| 门票+餐饮 | ¥4500–6500 |\n`;
  const totalLow = (retLow || 8000) + carLow + 1500 + (hotelTotal || 5600) + 4500;
  const totalHigh = (retHigh || 12000) + carHigh + 1800 + (hotelTotal || 9000) + 6500;
  md += `| **合计** | **约 ¥${(totalLow / 10000).toFixed(2)}万–${(totalHigh / 10000).toFixed(2)}万**（人均 ¥${(totalLow / PARTY / 1000).toFixed(0)}00–${(totalHigh / PARTY / 1000).toFixed(0)}00） |\n\n---\n\n`;
  return md;
}

function renderTodo(inboundByDate) {
  const todos = ITIN.todo?.length ? [...ITIN.todo] : [];
  const dates = TRIP.returnDateCompare || CFG.returnDates;
  if (dates.length >= 2) {
    const d1 = dates[1];
    const d0 = dates[0];
    const cheap1 = pickScenario(
      (inboundByDate.get(d1) || []).map((f) => ({ ...f, priceVerified: f.priceVerified !== false })),
      "cheapest",
      PROFILE
    );
    const cheap0 = pickScenario(
      (inboundByDate.get(d0) || []).map((f) => ({ ...f, priceVerified: f.priceVerified !== false })),
      "cheapest",
      PROFILE
    );
    if (cheap1 && cheap0) {
      todos[0] = `**订返程** — 优先 ${formatDateShort(d1)}（${cheap1.flightNo} ¥${cheap1.priceNum.toFixed(0)}）；若只能 ${formatDateShort(d0)} 选 ${cheap0.flightNo} ¥${cheap0.priceNum.toFixed(0)}`;
    }
  }
  if (!todos.length) return "";
  let md = `## 七、本周待办\n\n`;
  todos.forEach((t, i) => {
    md += `${i + 1}. ${t}\n`;
  });
  md += "\n";
  return md;
}

function main() {
  const { inputPath, hotelsPath, outPath } = parseArgs(process.argv);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Missing results file: ${inputPath}`);
  }

  const raw = fs.readFileSync(inputPath, "utf8");
  const results = compactMap(buildRouteMap(parseJsonl(raw))).filter((r) =>
    isConfiguredMonitorEntry(r, CFG)
  );
  const inbound = flattenFlights(results).filter((f) => !isOutboundRoute(f.route, CFG));
  const inboundByDate = new Map();
  for (const f of inbound) {
    if (!inboundByDate.has(f.date)) inboundByDate.set(f.date, []);
    inboundByDate.get(f.date).push(f);
  }

  const hotelsBySegment = loadHotelsBySegment(hotelsPath);

  let md = `# ${TRIP.label || "旅行计划"}（${PARTY} 人·自驾·10/1–10/8）\n\n`;
  md += `> 生成时间：${formatShanghaiTime()} | **去程已订 · 聚焦返程/酒店/行程**\n\n`;
  md += `---\n\n`;
  md += renderBookedOutbound();
  md += renderReturnSection(inboundByDate);
  const flatInbound = [...inboundByDate.values()].flat();
  md += renderItineraryConflictAdvisory(flatInbound, TRIP, PARTY, "plan");
  md += `---\n\n`;
  md += renderCarRental();
  md += renderItinerary(hotelsBySegment);
  md += renderHotelTable(hotelsBySegment);
  md += renderTips();
  md += renderBudget(inboundByDate, hotelsBySegment);
  md += renderTodo(inboundByDate);
  md += `---\n基于飞猪 fly.ai 实时数据 · 由 \`format-travel-plan.js\` 自动生成\n`;

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, md);
    process.stderr.write(`Travel plan saved: ${outPath}\n`);
  } else {
    process.stdout.write(md);
  }
}

main();
