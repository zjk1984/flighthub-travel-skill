#!/usr/bin/env node
/**
 * Score hotels per stay segment and render daily-style TOP3 Markdown (mirrors flight ranked report).
 *
 * Usage: node format-hotels-ranked.js [hotels.json] [--out reports/xinjiang-hotels-ranked.md]
 */
const fs = require("fs");
const path = require("path");
const { formatShanghaiTime } = require("./format-time");
const { loadConfig, formatDateShort } = require("./load-monitor-config");
const {
  getHotelProfile,
  parsePriceNum,
  roomCountForParty,
  scoreHotelsInSegment,
  buildDeductions,
} = require("./hotel-scoring");

const ROOT = path.join(__dirname, "..");
const TOP_N = 3;

function parseArgs(argv) {
  let input = path.join(ROOT, "reports/xinjiang-hotels-latest.json");
  let out = path.join(ROOT, "reports/xinjiang-hotels-ranked.md");
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) {
      out = argv[++i];
      continue;
    }
    if (!argv[i].startsWith("-")) input = argv[i];
  }
  return { input, out };
}

function normalizeHotels(raw) {
  return raw.map((h) => ({
    ...h,
    priceNum: h.priceNum != null ? h.priceNum : parsePriceNum(h.price),
    reviewScore: h.reviewScore ?? h.score ?? null,
  }));
}

function segmentSortKey(meta, list) {
  const checkin = meta?.checkIn || list[0]?.checkin || "";
  return checkin;
}

function formatStayRange(h) {
  const ci = h.checkin ? h.checkin.slice(5) : "—";
  const co = h.checkout ? h.checkout.slice(5) : "—";
  if (h.nights > 1) return `${ci}→${co}（${h.nights}晚）`;
  return `${ci}→${co}`;
}

function renderBookingLinks(h) {
  if (!h.url) return "   - 预订链接：暂无\n\n";
  return `   - [点击预订](${h.url})\n\n`;
}

function renderScoringGuide(profile, partySize, rooms) {
  const w = profile.weights;
  return `## 📐 酒店评分标准（v1 · ${profile.label}）

综合分 **越高越好**，满分 100。**按入住日/行程段**分组评分（同段酒店互相比较价格）。

${partySize > 1 ? `> 团队 **${partySize} 人** · **${rooms} 间**；「${rooms}间合计」= 单间夜价 × 晚数 × ${rooms}\n` : ""}

| 维度 | 权重 | 计分规则 |
|------|------|----------|
| 价格 | ${Math.round(w.price * 100)}% | 绝对档（<200→70，200–349→85，350–499→92）与**同段相对价**各 50% 加权 |
| 位置 | ${Math.round(w.location * 100)}% | 匹配 \`trip-profile\` 分段 \`poiPrefer\`（机场/景区/市区等） |
| 舒适度 | ${Math.round(w.comfort * 100)}% | 豪华 100 · 舒适 90 · 三星 78 · 经济 65 |
| 口碑 | ${Math.round(w.review * 100)}% | 平台评分 ≥4.8→100，≥4.5→92，≥4.0→85 |
| 品牌 | ${Math.round(w.brand * 100)}% | 老人画像偏好全季/星程/汉庭等；青旅/胶囊扣分 |

**公式：** 综合分 = Σ(子分 ÷ 100 × 权重) × 100

**TOP3 规则：** 每入住段取综合分最高的 3 家；表格含各维度子分，明细见扣分项。

`;
}

function renderDailySection(dayEntry, profile, rooms) {
  const { checkin, segmentLabel, destName, scored, candidateCount } = dayEntry;
  const short = checkin ? formatDateShort(checkin) : segmentLabel;
  const titleSuffix = segmentLabel && checkin ? ` · ${segmentLabel}` : segmentLabel || "";

  let md = `### ${short}（${checkin || "—"}）${titleSuffix}\n\n`;
  if (destName) md += `> 目的地：**${destName}** | 候选 ${candidateCount} 家\n\n`;

  if (!scored.length) {
    md += "暂无酒店数据\n\n";
    return md;
  }

  md += `| 排名 | 评分 | 城市 | 酒店 | 档次 | 单间/晚 | 价格分 | 位置分 | 舒适分 | 口碑分 | 品牌分 | ${rooms}间合计 | 入住→离店 | 位置 | 预订 |\n`;
  md += "|------|------|------|------|------|---------|--------|--------|--------|--------|--------|----------|----------|------|------|\n";

  scored.slice(0, TOP_N).forEach((h, i) => {
    const book = h.url ? `[预订](${h.url})` : "—";
    const reviewCol = h.reviewScore ? h.reviewPts : h.reviewPts;
    md +=
      `| ${i + 1} | ${h.score} | ${h.destName || destName || "—"} | ${h.name} | ${h.star || "—"} | ` +
      `¥${h.priceNum.toFixed(0)} | ${h.pricePts} | ${h.locationPts} | ${h.comfortPts} | ${reviewCol} | ${h.brandPts} | ` +
      `¥${h.stayTotal.toFixed(0)} | ${formatStayRange(h)} | ${h.poi || "—"} | ${book} |\n`;
  });

  md += "\n**扣分项明细：**\n\n";
  scored.slice(0, TOP_N).forEach((h, i) => {
    md += `${i + 1}. **${h.destName || destName || ""} · ${h.name}**（综合 ${h.score}）\n`;
    for (const line of buildDeductions(h, profile)) md += `   - ${line}\n`;
    md += renderBookingLinks(h);
  });

  return md;
}

function buildDayEntries(raw, trip, profile, partySize, roomCount) {
  const bySegment = new Map();
  for (const h of raw) {
    if (!bySegment.has(h.segment)) bySegment.set(h.segment, []);
    bySegment.get(h.segment).push(h);
  }

  const segmentMetaMap = new Map();
  for (const seg of trip.hotels || []) {
    segmentMetaMap.set(seg.segment, seg);
  }

  const entries = [];
  for (const [segmentLabel, list] of bySegment) {
    const meta = segmentMetaMap.get(segmentLabel) || { segment: segmentLabel };
    const scored = scoreHotelsInSegment(list, profile, meta, partySize, roomCount);
    entries.push({
      checkin: meta.checkIn || list[0]?.checkin || "",
      checkout: meta.checkOut || list[0]?.checkout || "",
      segmentLabel,
      destName: meta.destName || "",
      scored,
      candidateCount: list.length,
    });
  }

  entries.sort((a, b) => segmentSortKey(null, [{ checkin: a.checkin }]).localeCompare(
    segmentSortKey(null, [{ checkin: b.checkin }])
  ));
  return entries;
}

function renderReport(raw, cfg) {
  const trip = cfg.trip || {};
  const profileName = trip.hotelScoringProfile || trip.scoringProfile || "family_elder";
  const profile = getHotelProfile(profileName);
  const partySize = trip.partySize || 1;
  const rooms = roomCountForParty(partySize, trip.roomCount);
  const dayEntries = buildDayEntries(raw, trip, profile, partySize, trip.roomCount);
  const totalCandidates = raw.length;

  let md = `# 🏨 每日 TOP3 酒店评分推荐\n\n`;
  md += `> 生成时间：${formatShanghaiTime()} (Asia/Shanghai)\n\n`;
  if (trip.label) md += `> 行程：${trip.label}\n\n`;
  md += `- 入住段：${dayEntries.length} 段 | 候选酒店：${totalCandidates} 条`;
  if (partySize > 1) md += ` | ${partySize} 人 · ${rooms} 间`;
  md += `\n\n`;

  md += renderScoringGuide(profile, partySize, rooms);
  md += `## 🏨 每日 TOP3（按入住日）\n\n`;

  for (const day of dayEntries) {
    md += renderDailySection(day, profile, rooms);
  }

  md += `---\n基于飞猪 fly.ai 实时数据\n`;
  return md;
}

function main() {
  const { input, out } = parseArgs(process.argv);
  if (!fs.existsSync(input)) {
    throw new Error(`Missing hotels file: ${input}`);
  }
  const cfg = loadConfig();
  const raw = normalizeHotels(JSON.parse(fs.readFileSync(input, "utf8")));
  const md = renderReport(raw, cfg);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, md);
  process.stdout.write(md);
  process.stderr.write(`Hotels ranked saved: ${out}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  renderScoringGuide,
  renderDailySection,
  renderReport,
  normalizeHotels,
  buildDayEntries,
};
