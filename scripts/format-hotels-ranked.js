#!/usr/bin/env node
/**
 * Score hotels per segment and render TOP3 Markdown (flight ranked report style).
 *
 * Usage: node format-hotels-ranked.js [hotels.json] [--out reports/xinjiang-hotels-ranked.md]
 */
const fs = require("fs");
const path = require("path");
const { formatShanghaiTime } = require("./format-time");
const { loadConfig } = require("./load-monitor-config");
const {
  getHotelProfile,
  parsePriceNum,
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

function groupBySegment(hotels) {
  const map = new Map();
  for (const h of hotels) {
    if (!map.has(h.segment)) map.set(h.segment, []);
    map.get(h.segment).push(h);
  }
  return map;
}

function renderScoringGuide(profile, partySize) {
  const w = profile.weights;
  return `## 📐 酒店评分标准（v1 · ${profile.label}）

综合分 **越高越好**，满分 100。**按行程分段**评分（同段酒店互相比较价格）。

${partySize > 1 ? `> 团队 **${partySize} 人** ≈ **${Math.ceil(partySize / 2)} 间**；表格含单间夜价与估算连住合计\n` : ""}

| 维度 | 权重 | 计分规则 |
|------|------|----------|
| 价格 | ${Math.round(w.price * 100)}% | 绝对档（<200→70，200–349→85，350–499→92）与**同段相对价**各 50% 加权 |
| 位置 | ${Math.round(w.location * 100)}% | 匹配分段 POI 关键词（机场/景区/市区等），命中越多越高 |
| 舒适度 | ${Math.round(w.comfort * 100)}% | 豪华 100 · 舒适 90 · 三星 78 · 经济 65；老人画像偏低档民宿/青旅 |
| 口碑 | ${Math.round(w.review * 100)}% | 平台评分 ≥4.8→100，≥4.5→92，≥4.0→85 |
| 品牌 | ${Math.round(w.brand * 100)}% | 老人画像偏好全季/星程/汉庭等连锁；青旅/胶囊扣分 |

**公式：** 综合分 = Σ(子分 ÷ 100 × 权重) × 100

`;
}

function renderSegment(section, scored, profile) {
  let md = `### ${section}\n\n`;
  if (!scored.length) {
    md += "暂无数据\n\n";
    return md;
  }
  md += `| 排名 | 评分 | 酒店 | 档次 | 单间/晚 | ${scored[0]?.roomEstimate ? `${scored[0].roomEstimate}间合计` : "合计"} | 位置 | 口碑 |\n`;
  md += "|------|------|------|------|---------|---------|------|------|\n";
  scored.slice(0, TOP_N).forEach((h, i) => {
    const review = h.reviewScore ? `${h.reviewScore}` : "—";
    const total =
      h.stayTotal > h.priceNum
        ? `¥${h.stayTotal.toFixed(0)}`
        : `¥${h.priceNum.toFixed(0)}`;
    md += `| ${i + 1} | ${h.score} | ${h.name} | ${h.star || "—"} | ¥${h.priceNum.toFixed(0)} | ${total} | ${h.poi || "—"} | ${review} |\n`;
  });
  md += "\n**扣分项明细：**\n\n";
  scored.slice(0, TOP_N).forEach((h, i) => {
    md += `${i + 1}. **${h.name}**（综合 ${h.score}）\n`;
    for (const line of buildDeductions(h)) md += `   - ${line}\n`;
    if (h.url) md += `   - [点击预订](${h.url})\n`;
    md += "\n";
  });
  return md;
}

function main() {
  const { input, out } = parseArgs(process.argv);
  if (!fs.existsSync(input)) {
    throw new Error(`Missing hotels file: ${input}`);
  }
  const cfg = loadConfig();
  const trip = cfg.trip || {};
  const profileName = trip.hotelScoringProfile || trip.scoringProfile || "family_elder";
  const profile = getHotelProfile(profileName);
  const partySize = trip.partySize || 1;

  const raw = normalizeHotels(JSON.parse(fs.readFileSync(input, "utf8")));
  const bySegment = groupBySegment(raw);

  const segmentMetaMap = new Map();
  for (const seg of trip.hotels || []) {
    segmentMetaMap.set(seg.segment, seg);
  }

  let md = `# 🏨 酒店 TOP3 评分推荐\n\n`;
  md += `> 生成时间：${formatShanghaiTime()} (Asia/Shanghai)\n\n`;
  if (trip.label) md += `> 行程：${trip.label}\n\n`;
  md += renderScoringGuide(profile, partySize);
  md += `## 分段推荐\n\n`;

  for (const [section, list] of bySegment) {
    const meta = segmentMetaMap.get(section) || { segment: section };
    const scored = scoreHotelsInSegment(list, profile, meta, partySize);
    md += renderSegment(section, scored, profile);
  }

  md += `---\n基于飞猪 fly.ai 实时数据\n`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, md);
  process.stdout.write(md);
  process.stderr.write(`Hotels ranked saved: ${out}\n`);
}

if (require.main === module) {
  main();
}

module.exports = { renderScoringGuide, renderSegment, normalizeHotels };
