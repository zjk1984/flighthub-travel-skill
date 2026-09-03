/**
 * Shared travel plan + hotel arrangement rendering for brief and plan reports.
 */
const fs = require("fs");
const { formatDateShort } = require("./load-monitor-config");
const {
  getHotelProfile,
  parsePriceNum,
  scoreHotelsInSegment,
} = require("./hotel-scoring");
const { getProfile, pickScenario, isSameDayArrival } = require("./scoring-profiles");

function segmentForDate(dateStr, hotels) {
  for (const seg of hotels || []) {
    if (dateStr >= seg.checkIn && dateStr < seg.checkOut) return seg.segment;
  }
  return null;
}

function pickHotelForPlan(scored, hotelProfile) {
  if (!scored.length) return null;
  if (hotelProfile?.elderFriendly) {
    const comfy = scored.filter((h) => h.comfortPts >= 78);
    if (comfy.length) return comfy[0];
    const branded = scored.filter((h) => h.brandPts >= 100);
    if (branded.length) return branded[0];
  }
  return scored[0];
}

function pickHotelBackup(scored, primary) {
  if (!scored.length) return null;
  const rest = scored.filter((h) => h.name !== primary?.name);
  return rest[0] || null;
}

function loadHotelsBySegment(hotelsPath, trip, partySize) {
  if (!fs.existsSync(hotelsPath)) return new Map();
  const raw = JSON.parse(fs.readFileSync(hotelsPath, "utf8")).map((h) => ({
    ...h,
    priceNum: h.priceNum != null ? h.priceNum : parsePriceNum(h.price),
    reviewScore: h.reviewScore ?? h.score ?? null,
  }));
  const hotelProfile = getHotelProfile(trip.scoringProfile || "family_elder");
  const bySegment = new Map();
  for (const seg of trip.hotels || []) {
    const list = raw.filter((h) => h.segment === seg.segment);
    if (!list.length) continue;
    const scored = scoreHotelsInSegment(list, hotelProfile, seg, partySize);
    const pick = pickHotelForPlan(scored, hotelProfile);
    const backup = pickHotelBackup(scored, pick);
    bySegment.set(seg.segment, { pick, backup, scored, seg });
  }
  return bySegment;
}

function renderItineraryTable(trip, hotelsBySegment) {
  const days = trip.itinerary?.days || [];
  if (!days.length) return "";

  let md = `## 📅 每日行程 + 酒店安排\n\n`;
  if (trip.itinerary?.overview) {
    md += `> ${trip.itinerary.overview}\n\n`;
  }
  md += `| 日期 | 行程安排 | 车程 | 推荐酒店 | 档次 | 3间合计 | 预订 |\n`;
  md += `|------|----------|------|----------|------|---------|------|\n`;

  for (const day of days) {
    const segKey = segmentForDate(day.date, trip.hotels);
    let hotel = "—";
    let star = "—";
    let total = "—";
    let book = "—";
    if (segKey && hotelsBySegment.has(segKey)) {
      const { pick } = hotelsBySegment.get(segKey);
      if (pick) {
        hotel = `**${pick.name}**`;
        star = pick.star || "—";
        total = pick.stayTotal ? `¥${pick.stayTotal.toFixed(0)}` : `¥${(pick.priceNum * Math.ceil((trip.partySize || 1) / 2)).toFixed(0)}`;
        book = pick.url ? `[订](${pick.url})` : "—";
      }
    } else if (day.stay && day.stay !== "—") {
      hotel = day.stay;
    }
    md += `| **${day.label}** | ${day.activity} | ${day.drive || "—"} | ${hotel} | ${star} | ${total} | ${book} |\n`;
  }
  return md + "\n";
}

function renderHotelBookingSheet(trip, hotelsBySegment) {
  if (!hotelsBySegment.size) {
    return `## 🏨 酒店预订清单\n\n> 暂无酒店数据，请运行 \`npm run monitor:hotels\`\n\n`;
  }

  let md = `## 🏨 酒店预订清单（${trip.partySize || 1} 人 ≈ ${Math.ceil((trip.partySize || 1) / 2)} 间）\n\n`;
  md += `| 入住段 | 日期 | 首选（老人友好） | 备选 | 单间/晚 | 段合计 | 预订 |\n`;
  md += `|--------|------|------------------|------|---------|--------|------|\n`;

  for (const [, { pick, backup, seg }] of hotelsBySegment) {
    if (!pick) continue;
    const range = `${seg.checkIn.slice(5)}→${seg.checkOut.slice(5)}`;
    const book = pick.url ? `[首选](${pick.url})` : "—";
    const backupCell = backup
      ? backup.url
        ? `[${backup.name}](${backup.url}) ¥${backup.priceNum}`
        : `${backup.name} ¥${backup.priceNum}`
      : "—";
    md += `| ${seg.segment} | ${range} | **${pick.name}** | ${backupCell} | ¥${pick.priceNum} | ¥${pick.stayTotal?.toFixed(0) || "—"} | ${book} |\n`;
  }
  md += `\n> 各段 TOP3 评分与扣分明细见下方「酒店评分明细」\n\n`;
  return md;
}

function renderCarRentalBrief(itinerary) {
  const c = itinerary?.carRental;
  if (!c) return "";
  let md = `## 🚗 租车安排\n\n`;
  md += `| 项目 | 建议 |\n|------|------|\n`;
  md += `| 车型 | **${c.type || "7 座 SUV/MPV"}** |\n`;
  md += `| 取还 | **${c.pickup || "—"} → ${c.return || "—"}** |\n`;
  if (c.costPerDay?.length === 2) {
    md += `| 预算 | ¥${c.costPerDay[0]}–${c.costPerDay[1]}/天 × 7 天 ≈ **¥${c.costPerDay[0] * 7}–${c.costPerDay[1] * 7}** |\n`;
  }
  if (c.tips?.length) md += `| 注意 | ${c.tips.join("、")} |\n`;
  return md + "\n";
}

function renderTodoBrief(trip, inboundByDate, profile) {
  const todos = trip.itinerary?.todo?.length ? [...trip.itinerary.todo] : [];
  const dates = trip.returnDateCompare || [];
  if (dates.length >= 2 && inboundByDate) {
    const cheap1 = pickScenario(
      (inboundByDate.get(dates[1]) || []).map((f) => ({ ...f, priceVerified: f.priceVerified !== false })),
      "cheapest",
      profile
    );
    const cheap0 = pickScenario(
      (inboundByDate.get(dates[0]) || []).map((f) => ({ ...f, priceVerified: f.priceVerified !== false })),
      "cheapest",
      profile
    );
    if (cheap1 && cheap0) {
      todos[0] = `**订返程** — 优先 ${formatDateShort(dates[1])}（${cheap1.flightNo} ¥${cheap1.priceNum.toFixed(0)}）；备选 ${formatDateShort(dates[0])}（${cheap0.flightNo} ¥${cheap0.priceNum.toFixed(0)}）`;
    }
  }
  if (!todos.length) return "";
  let md = `## ✅ 本周待办\n\n`;
  todos.forEach((t, i) => {
    md += `${i + 1}. ${t}\n`;
  });
  return md + "\n";
}

function renderTipsBrief(itinerary) {
  const t = itinerary?.tips;
  if (!t) return "";
  let md = `## 💡 出行提示\n\n`;
  if (t.elder) md += `- **老人：** ${t.elder}\n`;
  if (t.teen) md += `- **小孩：** ${t.teen}\n`;
  if (t.family) md += `- **全家：** ${t.family}\n`;
  return md + "\n";
}

module.exports = {
  segmentForDate,
  pickHotelForPlan,
  loadHotelsBySegment,
  renderItineraryTable,
  renderHotelBookingSheet,
  renderCarRentalBrief,
  renderTodoBrief,
  renderTipsBrief,
};
