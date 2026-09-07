#!/usr/bin/env node
/**
 * Query hotels from trip-profile segments via flyai search-hotel.
 *
 * Usage: node monitor-hotels.js [--profile config/trip-profile.json] [--out reports/xinjiang-hotels-latest.json]
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { loadConfig } = require("./load-monitor-config");
const { loadTripProfile, DEFAULT_PROFILE_PATH } = require("./load-trip-profile");
const { sleep } = require("./search-queue");
const { parsePriceNum } = require("./hotel-scoring");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile();

function parseArgs(argv) {
  let profilePath = null;
  let outPath = path.join(ROOT, "reports/xinjiang-hotels-latest.json");
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--profile" && argv[i + 1]) {
      profilePath = argv[++i];
      continue;
    }
    if (argv[i] === "--out" && argv[i + 1]) {
      outPath = argv[++i];
      continue;
    }
  }
  return { profilePath, outPath };
}

function runHotelSearch(segment, overrides = {}) {
  const flyai = process.env.FLYAI || "npx @fly-ai/flyai-cli";
  const args = [
    "search-hotel",
    "--dest-name",
    segment.destName,
    "--check-in-date",
    segment.checkIn,
    "--check-out-date",
    segment.checkOut,
    "--sort",
    overrides.sort || segment.sort || "price_asc",
    "--hotel-types",
    overrides.hotelTypes || segment.hotelTypes || "酒店",
  ];
  if (segment.maxPrice && !overrides.ignoreMaxPrice) {
    args.push("--max-price", String(segment.maxPrice));
  }
  if (overrides.poiName) {
    args.push("--poi-name", overrides.poiName);
  } else if (overrides.usePoi || segment.segment?.includes("机场") || segment.scenicPoi) {
    const poi =
      segment.scenicPoi ||
      segment.poiPrefer?.find((p) => !["市区", "县城", "昭苏", "特克斯", "博乐", "尼勒克"].includes(p)) ||
      segment.poiPrefer?.[0];
    if (poi) args.push("--poi-name", poi);
  }
  if (overrides.keyWords || segment.keyWords) {
    args.push("--key-words", overrides.keyWords || segment.keyWords);
  }
  if (segment.hotelStars || overrides.hotelStars) {
    args.push("--hotel-stars", segment.hotelStars || overrides.hotelStars);
  }
  const cmd = flyai.split(/\s+/);
  const execSearch = () =>
    execFileSync(cmd[0], [...cmd.slice(1), ...args], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      cwd: ROOT,
    });
  try {
    return JSON.parse(execSearch().trim());
  } catch (e) {
    const stdout = e.stdout ? String(e.stdout) : "";
    const errText = `${e.message || ""} ${stdout}`;
    if (/451|risk control|Abnormal access/.test(errText)) {
      process.stderr.write(`Rate limited ${segment.destName} — waiting 45s…\n`);
      try {
        execFileSync("sleep", ["45"], { encoding: "utf8" });
        return JSON.parse(execSearch().trim());
      } catch (retryErr) {
        e = retryErr;
      }
    }
    if (stdout.trim()) {
      try {
        return JSON.parse(stdout.trim());
      } catch (_) {
        /* fall through */
      }
    }
    process.stderr.write(
      `Hotel search failed ${segment.destName} ${segment.checkIn}: ${e.message}\n`
    );
    return null;
  }
}

function dedupeHotels(rows) {
  const seen = new Set();
  const out = [];
  for (const h of rows) {
    const key = `${h.name}|${h.checkin}|${h.checkout}|${h.lodgingType || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

function isScenicHomestayCandidate(h, seg) {
  const scenic = Array.isArray(seg.scenicPoi) ? seg.scenicPoi : seg.scenicPoi ? [seg.scenicPoi] : [];
  const text = `${h.poi || ""} ${h.address || ""} ${h.name || ""}`;
  if (/青年旅舍|青旅|胶囊|床位|漫威电竞|华松旅社|华腾宾馆/.test(text)) return false;

  const hasYuhu = scenic.some((k) => /玉湖/.test(k));
  const hasBagua = scenic.some((k) => /八卦城/.test(k));
  const hasKalajun = scenic.some((k) => /喀拉峻/.test(k));
  const hasTangbula = scenic.some((k) => /唐布拉/.test(k));
  const hasSayram = scenic.some((k) => /赛里木湖|赛湖/.test(k));

  if (hasYuhu && /夏塔|天马|文化广场|近昭苏|南城区|灯塔知青/.test(text) && !/玉湖|望湖|葛洲坝|别迭|喀夏加尔/.test(text)) {
    return false;
  }
  if (hasKalajun && /琼库什台/.test(text) && !/喀拉峻|阔克苏|波森|别克|霍斯宝|云雾牧|无垠/.test(text)) {
    return false;
  }
  if (hasKalajun && /八卦城|县人民政府|离街|太极坛/.test(text) && !/喀拉峻|阔克苏|波森|别克|琼库/.test(text)) {
    return false;
  }
  if (hasSayram && /赛里木湖路|灵壤|天祥国际|建材家具|博乐巨辉|时代酒店/.test(text) && !/风景名胜|景区|游客中心|赛里木湖国家级/.test(text)) {
    return false;
  }
  if (hasSayram && /大酒店|时代酒店/.test(h.name) && !/赛湖|赛里木|风景名胜/.test(text)) return false;
  if (/汉庭|麗枫|维也纳国际|全季|亚朵|中亚全纳|博乐赛湖云上|博乐市海景酒店/.test(h.name) && !/民宿|毡房|鱼坊|山庄|营地|野奢|拾光|喜见|云湖/.test(h.name)) {
    return false;
  }
  if (hasBagua && /大酒店/.test(h.name) && !/民宿|客栈|花筑|半坡|闲庭/.test(text)) return false;
  if (/近昭苏$|天马大道|文化广场|文化路\d|工矿路|乌孙路\d号$/.test(text) && !/玉湖|望湖|景区/.test(text)) {
    return false;
  }

  if (scenic.some((k) => k && text.includes(k))) return true;
  const poiPatterns = {
    玉湖景区: /玉湖|望湖|葛洲坝|别迭|喀夏加尔|木子陶|小别迭/,
    葛洲坝玉湖: /玉湖|望湖|葛洲坝|别迭|喀夏加尔|木子陶|小别迭/,
    八卦城: /八卦城|离街|半坡|闲庭民宿/,
    喀拉峻: /喀拉峻|阔克苏|波森|别克|霍斯宝|云雾牧|无垠|牧业村/,
    唐布拉: /唐布拉|放蜂|野奢|巴依阿吾勒|百里画廊|315国道|乌拉斯台/,
    赛里木湖: /赛里木湖|赛湖|拾光|云湖|鸿泽|鱼坊|游客中心|风景名胜|喜见|鲸语|毡房|入画入梦|白鸟湖/,
  };
  for (const poi of scenic) {
    if (poiPatterns[poi]?.test(text)) return true;
  }
  if (/民宿|牧家乐|山庄|营地|度假村|庄园|毡房|鱼坊/.test(h.name) && /乡|村|景区|风景名胜|315国道|牧场|牧业村|别迭|游客中心/.test(text)) return true;
  if (hasTangbula && /放蜂|野奢|巴依阿吾勒|唐布拉/.test(text)) return true;
  return false;
}

function filterScenicHomestays(rows, seg) {
  return rows.filter((h) => isScenicHomestayCandidate(h, seg));
}

function curatedKeywordFromName(name) {
  if (!name) return "";
  const cleaned = String(name)
    .replace(/[（(].*$/, "")
    .replace(/[·・].*$/, "")
    .trim();
  const tail = cleaned.match(/(?:喀拉峻|玉湖|唐布拉|赛里木湖|赛湖|八卦城)(.+)?$/);
  if (tail) return tail[0].slice(0, 12);
  return cleaned.slice(-8);
}

async function runScenicSearchBatch(seg, rows, topN, searches) {
  for (const s of searches) {
    const payload = runHotelSearch(seg, {
      sort: "price_asc",
      hotelTypes: "民宿",
      poiName: s.poiName,
      keyWords: s.keyWords,
      usePoi: !!s.poiName,
      ignoreMaxPrice: seg.scenicHomestay,
    });
    if (payload) rows.push(...mapHotels(seg, payload, topN, "民宿", s.poiName || s.keyWords));
    await sleep(2500);
  }
}

async function searchSegment(seg, elderFriendly, hotelOverrides = {}) {
  const topN = seg.topN || 8;
  const rows = [];

  if (seg.scenicHomestay && seg.scenicPoi) {
    const pois = Array.isArray(seg.scenicPoi) ? seg.scenicPoi : [seg.scenicPoi];
    const extraSearches = [...(seg.extraKeywordSearches || [])];
    const curated = hotelOverrides[seg.checkIn];
    if (curated?.name) {
      const kw = curatedKeywordFromName(curated.name);
      if (kw && !extraSearches.some((s) => s.keyWords?.includes(kw))) {
        extraSearches.push({ keyWords: kw });
      }
    }

    for (const poiName of pois) {
      const payload = runHotelSearch(seg, {
        sort: "price_asc",
        hotelTypes: "民宿",
        poiName,
        usePoi: true,
        ignoreMaxPrice: seg.scenicHomestay,
      });
      if (payload) rows.push(...mapHotels(seg, payload, topN, "民宿", poiName));
      await sleep(2500);
    }
    await runScenicSearchBatch(seg, rows, topN, extraSearches);

    if (!rows.length) {
      const fallback = runHotelSearch(seg, {
        sort: "price_asc",
        hotelTypes: "民宿",
        poiName: pois[0],
        keyWords: seg.keyWords || "民宿",
        usePoi: true,
      });
      if (fallback) rows.push(...mapHotels(seg, fallback, topN, "民宿", pois[0]));
    }
    return dedupeHotels(filterScenicHomestays(rows, seg));
  }

  const types = seg.preferHomestay ? ["民宿", "酒店"] : [seg.hotelTypes || "酒店"];

  for (const lodgingType of types) {
    const pricePayload = runHotelSearch(seg, {
      sort: "price_asc",
      hotelTypes: lodgingType,
      usePoi: seg.segment?.includes("机场") || seg.poiPrefer?.includes("喀赞其"),
    });
    if (pricePayload) rows.push(...mapHotels(seg, pricePayload, topN, lodgingType));

    if (elderFriendly && lodgingType === "酒店") {
      const comfortPayload = runHotelSearch(seg, {
        sort: "rate_desc",
        hotelTypes: lodgingType,
        hotelStars: seg.hotelStars || "4,5",
        usePoi: !!seg.poiPrefer?.[0],
        keyWords: seg.keyWords || "全季 星程 舒适",
        ignoreMaxPrice: false,
      });
      if (comfortPayload) rows.push(...mapHotels(seg, comfortPayload, topN, lodgingType));
    }
    if (lodgingType === "民宿") await sleep(1200);
  }

  if (!rows.length && seg.poiPrefer?.[0]) {
    const poiPayload = runHotelSearch(seg, { sort: "rate_desc", usePoi: true });
    if (poiPayload) rows.push(...mapHotels(seg, poiPayload, topN, "酒店"));
  }
  return dedupeHotels(rows);
}

function mapHotels(segment, payload, topN, lodgingType, searchPoi) {
  const list = payload?.data?.itemList || payload?.itemList || [];
  return list.slice(0, topN).map((h, i) => {
    const priceRaw = h.price || h.lowestPrice || "";
    const priceNum = parsePriceNum(priceRaw);
    return {
      segment: segment.segment,
      checkin: segment.checkIn,
      checkout: segment.checkOut,
      apiRank: i + 1,
      lodgingType: lodgingType || segment.hotelTypes || "酒店",
      searchPoi: searchPoi || segment.scenicPoi || "",
      name: h.hotelName || h.name || "—",
      price: priceNum > 0 ? `¥${priceNum}` : String(priceRaw || "—"),
      priceNum,
      star: h.star || h.hotelStar || "—",
      brandName: h.brandName || "",
      poi: h.interestsPoi || h.address || "—",
      address: h.address || "",
      reviewScore: h.score != null ? String(h.score) : null,
      reviewDesc: h.scoreDesc || h.review || "",
      url: h.detailUrl || h.jumpUrl || "",
    };
  });
}

async function main() {
  const { profilePath, outPath } = parseArgs(process.argv);
  if (process.env.FLYAI_API_KEY) {
    try {
      const flyai = (process.env.FLYAI || "npx @fly-ai/flyai-cli").split(/\s+/);
      execFileSync(flyai[0], [...flyai.slice(1), "config", "set", "FLYAI_API_KEY", process.env.FLYAI_API_KEY], {
        encoding: "utf8",
        cwd: ROOT,
      });
    } catch (_) {
      /* non-fatal */
    }
  }
  const cfg = loadConfig();
  const trip = profilePath
    ? loadTripProfile({ tripProfilePath: profilePath, focusMode: false })
    : cfg.trip;
  const segments = [...(trip.hotels || [])];
  if (!segments.length) {
    process.stderr.write("No hotel segments in trip profile — skipping\n");
    return;
  }

  if (!process.env.FLYAI_API_KEY) {
    process.stderr.write("Warning: FLYAI_API_KEY not set — hotel prices may be trial/masked\n");
  }

  const elderFriendly = trip.scoringProfile === "family_elder";
  const hotelOverrides = trip.hotelOverrides || {};
  const all = [];
  for (const seg of segments) {
    process.stderr.write(`Hotels: ${seg.segment} → ${seg.destName} ${seg.checkIn}..${seg.checkOut}\n`);
    const rows = await searchSegment(seg, elderFriendly, hotelOverrides);
    all.push(...rows);
    process.stderr.write(`  → ${rows.length} candidates (price + comfort pool)\n`);
    await sleep(4000);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(all, null, 2) + "\n");
  process.stderr.write(`Hotels saved: ${outPath} (${all.length} rows)\n`);

  const rankedOut = outPath.replace(/\.json$/, "-ranked.md");
  const r = spawnSync("node", [path.join(__dirname, "format-hotels-ranked.js"), outPath, "--out", rankedOut], {
    encoding: "utf8",
    cwd: ROOT,
  });
  if (r.status !== 0) {
    process.stderr.write(r.stderr || "format-hotels-ranked failed\n");
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { searchSegment, runHotelSearch, filterScenicHomestays, mapHotels };
