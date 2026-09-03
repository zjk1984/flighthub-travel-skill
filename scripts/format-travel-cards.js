#!/usr/bin/env node
/**
 * 8-day card-style travel plan (one card per day).
 *
 * Usage: node format-travel-cards.js [--out reports/xinjiang-travel-cards.md]
 */
const fs = require("fs");
const path = require("path");
const { formatShanghaiTime } = require("./format-time");
const { loadConfig } = require("./load-monitor-config");
const { loadHotelsBySegment, segmentForDate } = require("./travel-plan-lib");

const ROOT = path.join(__dirname, "..");
const CFG = loadConfig();
const TRIP = CFG.trip || {};
const PARTY = TRIP.partySize || 1;

/** User-specified hotel overrides when API has no match */
const HOTEL_OVERRIDES = {
  "2026-10-02": {
    name: "美豪丽致酒店(昭苏天马湖店)",
    price: "¥245/间",
    note: "D2-D3 连住；平台搜「昭苏 天马湖」",
  },
  "2026-10-04": {
    name: "特克斯天麓酒店",
    price: "请平台搜「特克斯 天麓」",
    note: "D4 指定；API 未命中时备选亚朵(迎宾南路)或全季太极坛",
  },
  "2026-10-06": {
    name: "博乐赛湖云上酒店 / 赛湖之畔",
    price: "¥463–890/间",
    note: "近赛里木湖东门，看日落星空；勿住博乐市区过远",
  },
};

function parseArgs(argv) {
  let out = path.join(ROOT, "reports/xinjiang-travel-cards.md");
  let hotelsPath = path.join(ROOT, "reports/xinjiang-hotels-latest.json");
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) out = argv[++i];
    else if (argv[i] === "--hotels" && argv[i + 1]) hotelsPath = argv[++i];
  }
  return { out, hotelsPath };
}

function weekday(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
}

function stayLine(dateStr, hotelsBySegment, dayStay) {
  const override = HOTEL_OVERRIDES[dateStr];
  const segKey = segmentForDate(dateStr, TRIP.hotels);
  if (segKey && hotelsBySegment.has(segKey)) {
    const { pick, backup } = hotelsBySegment.get(segKey);
    if (pick) {
      const book = pick.url ? `[预订](${pick.url})` : "";
      let s = `**${pick.name}**（${pick.star || "—"} · ¥${pick.priceNum}/间`;
      if (pick.stayTotal) s += ` · 3间≈¥${pick.stayTotal.toFixed(0)}`;
      s += `）${book ? " " + book : ""}`;
      if (backup) s += `\n> 备选：${backup.name} ¥${backup.priceNum}/间`;
      return s;
    }
  }
  if (override) {
    return `**${override.name}**（${override.note}）`;
  }
  return dayStay || "—";
}

function renderCard(day, hotelsBySegment) {
  const wd = weekday(day.date);
  let md = `### 📍 ${day.cardId || day.label} · ${day.date.slice(5)} ${wd}\n\n`;
  md += `> **${day.title || day.label}**\n\n`;
  md += `| | |\n|---|---|\n`;
  md += `| **行程** | ${day.activity} |\n`;
  md += `| **车程** | ${day.drive || "—"} |\n`;
  md += `| **住宿** | ${stayLine(day.date, hotelsBySegment, day.stay)} |\n`;
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

function main() {
  const { out, hotelsPath } = parseArgs(process.argv);
  const days = TRIP.itinerary?.days || [];
  const hotelsBySegment = loadHotelsBySegment(hotelsPath, TRIP, PARTY);

  let md = `# 伊犁 8 天自驾旅行计划\n\n`;
  md += `> ${TRIP.label || "伊犁自驾"} · **${PARTY} 人** · **10/1–10/8**\n`;
  md += `> 生成时间：${formatShanghaiTime()}\n\n`;
  if (TRIP.bookedOutbound) {
    const b = TRIP.bookedOutbound;
    md += `✈️ **去程已订：** ${b.route} ${b.date} ${b.flightNo}（${b.note || ""}）\n\n`;
  }
  if (TRIP.itinerary?.overview) {
    md += `**环线概要：** ${TRIP.itinerary.overview}\n\n`;
  }
  md += `---\n\n`;

  for (const day of days) {
    md += renderCard(day, hotelsBySegment);
  }

  md += renderTips(TRIP.itinerary);

  if (TRIP.itinerary?.carRental) {
    const c = TRIP.itinerary.carRental;
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

main();
