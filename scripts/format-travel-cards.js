#!/usr/bin/env node
/**
 * 8-day card-style travel plan (one card per day).
 *
 * Usage:
 *   node format-travel-cards.js [--out reports/xinjiang-travel-cards.md]
 *   node format-travel-cards.js --variant planb --out reports/xinjiang-travel-cards-planb.md
 */
const fs = require("fs");
const path = require("path");
const { formatShanghaiTime } = require("./format-time");
const { loadConfig } = require("./load-monitor-config");
const { loadHotelsBySegment, segmentForDate } = require("./travel-plan-lib");
const { roomCountForParty } = require("./hotel-scoring");

const ROOT = path.join(__dirname, "..");
const CFG = loadConfig();

/** Shared overrides when API has no match (独库主方案) */
const DEFAULT_HOTEL_OVERRIDES = {
  "2026-10-02": {
    name: "伊宁市区（六星街/将军府）",
    price: "¥300–450/间",
    note: "D2 休整；搜「六星街」「将军府」「喀赞其」",
  },
  "2026-10-03": {
    name: "美豪丽致酒店(昭苏天马湖店)",
    price: "¥245/间",
    note: "D3-D4 连住昭苏",
  },
  "2026-10-05": {
    name: "新源/那拉提镇",
    price: "¥250–350/间",
    note: "D5 特克斯→那拉提（Plan A）；搜「新源」或「那拉提镇」",
  },
  "2026-10-06": {
    name: "博乐赛湖云上酒店 / 赛湖之畔",
    price: "¥463–890/间",
    note: "D6 独库→赛湖东门；勿住博乐市区",
  },
  "2026-10-07": {
    name: "博乐友好亚朵 / 万达悦华",
    price: "¥400–500/间",
    note: "D7 赛湖→博乐；方便 D8 还车",
  },
};

function parseArgs(argv) {
  let out = path.join(ROOT, "reports/xinjiang-travel-cards.md");
  let hotelsPath = path.join(ROOT, "reports/xinjiang-hotels-latest.json");
  let variant = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) out = argv[++i];
    else if (argv[i] === "--hotels" && argv[i + 1]) hotelsPath = argv[++i];
    else if (argv[i] === "--variant" && argv[i + 1]) variant = argv[++i];
  }
  return { out, hotelsPath, variant };
}

function buildContext(variant) {
  const trip = CFG.trip || {};
  const partySize = trip.partySize || 1;
  if (!variant) {
    return {
      trip,
      partySize,
      label: trip.label || "伊犁自驾",
      itinerary: trip.itinerary || {},
      hotels: trip.hotels || [],
      hotelOverrides: DEFAULT_HOTEL_OVERRIDES,
      rooms: roomCountForParty(trip.partySize, trip.roomCount),
      variantNote: trip.itinerary?.alternateRoute
        ? `> **可选路线：** ${trip.itinerary.alternateRoute}\n\n`
        : "",
      titleSuffix: "",
    };
  }
  const v = trip.itineraryVariants?.[variant];
  if (!v) throw new Error(`Unknown itinerary variant: ${variant}`);
  return {
    trip,
    partySize,
    label: v.label || trip.label,
    itinerary: v.itinerary || {},
    hotels: v.hotels || trip.hotels || [],
    hotelOverrides: { ...DEFAULT_HOTEL_OVERRIDES, ...(v.hotelOverrides || {}) },
    rooms: roomCountForParty(trip.partySize, trip.roomCount),
    variantNote: v.fallbackNote ? `> **备选说明：** ${v.fallbackNote}\n\n` : "",
    titleSuffix: variant === "planb" ? " · Plan B 备选" : "",
  };
}

function weekday(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
}

function stayLine(dateStr, hotelsBySegment, dayStay, ctx) {
  const override = ctx.hotelOverrides[dateStr];
  const segKey = segmentForDate(dateStr, ctx.hotels);
  if (segKey && hotelsBySegment.has(segKey)) {
    const { pick, backup } = hotelsBySegment.get(segKey);
    if (pick && !override) {
      const book = pick.url ? `[预订](${pick.url})` : "";
      let s = `**${pick.name}**（${pick.star || "—"} · ¥${pick.priceNum}/间`;
      if (pick.stayTotal) s += ` · ${ctx.rooms}间≈¥${pick.stayTotal.toFixed(0)}`;
      s += `）${book ? " " + book : ""}`;
      if (backup) s += `\n> 备选：${backup.name} ¥${backup.priceNum}/间`;
      return s;
    }
  }
  if (override) {
    let s = `**${override.name}**`;
    if (override.price) s += `（${override.price}`;
    if (override.note) s += override.price ? ` · ${override.note}）` : `（${override.note}）`;
    else if (override.price) s += `）`;
    if (segKey && hotelsBySegment.has(segKey)) {
      const { pick } = hotelsBySegment.get(segKey);
      if (pick && !pick.name.includes("天麓")) {
        const book = pick.url ? `[备选预订](${pick.url})` : "";
        s += `\n> API 备选：**${pick.name}** ¥${pick.priceNum}/间 ${book}`;
      }
    }
    return s;
  }
  return dayStay || "—";
}

function renderCard(day, hotelsBySegment, ctx) {
  const wd = weekday(day.date);
  const head = `${day.cardId || day.label} ${day.date.slice(5)} ${day.title || ""}`.trim();
  let md = `### 📍 ${head}（${wd}）\n\n`;
  md += `| | |\n|---|---|\n`;
  md += `| **行程** | ${day.activity} |\n`;
  md += `| **车程** | ${day.drive || "—"} |\n`;
  md += `| **住宿** | ${stayLine(day.date, hotelsBySegment, day.stay, ctx)} |\n`;
  if (day.note) md += `| **提示** | ${day.note} |\n`;
  md += `\n---\n\n`;
  return md;
}

function renderTips(itinerary) {
  const tips = itinerary?.importantTips || itinerary?.tips;
  if (!tips) return "";
  let md = `## ⚠️ 重要提示\n\n`;
  if (Array.isArray(tips)) {
    tips.forEach((t, i) => {
      md += `${i + 1}. ${t}\n`;
    });
  } else if (typeof tips === "object") {
    if (tips.important) tips.important.forEach((t, i) => (md += `${i + 1}. ${t}\n`));
  }
  return md + "\n";
}

function renderCards(ctx, hotelsPath, out) {
  const days = ctx.itinerary?.days || [];
  const tripForHotels = { ...ctx.trip, hotels: ctx.hotels };
  const hotelsBySegment = loadHotelsBySegment(hotelsPath, tripForHotels, ctx.partySize);

  let md = `# 伊犁 8 天自驾旅行计划${ctx.titleSuffix}\n\n`;
  md += `> ${ctx.label} · **${ctx.partySize} 人 · ${ctx.rooms} 间** · **10/1–10/8**\n`;
  md += `> 生成时间：${formatShanghaiTime()}\n\n`;
  if (ctx.trip.bookedOutbound) {
    const b = ctx.trip.bookedOutbound;
    md += `✈️ **去程已订：** ${b.route} ${b.date} ${b.flightNo}（${b.note || ""}）\n\n`;
  }
  if (ctx.itinerary?.overview) {
    md += `**环线概要：** ${ctx.itinerary.overview}\n\n`;
  }
  if (ctx.variantNote) md += ctx.variantNote;
  md += `---\n\n`;

  for (const day of days) {
    md += renderCard(day, hotelsBySegment, ctx);
  }

  md += renderTips(ctx.itinerary);

  if (ctx.itinerary?.carRental) {
    const c = ctx.itinerary.carRental;
    md += `## 🚗 租车\n\n`;
    md += `- **车型：** ${c.type}\n`;
    md += `- **取还：** ${c.pickup} → ${c.return}\n`;
    if (c.tips?.length) md += `- **注意：** ${c.tips.join("；")}\n`;
    md += `\n`;
  }

  md += `---\n*基于 trip-profile + fly.ai 酒店实价 · \`format-travel-cards.js\`*\n`;

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, md);
  process.stderr.write(`Travel cards saved: ${out}\n`);
}

function main() {
  const { out, hotelsPath, variant } = parseArgs(process.argv);
  const ctx = buildContext(variant);
  renderCards(ctx, hotelsPath, out);
}

main();
