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
  const flyai = process.env.FLYAI || "npx flyai";
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
    "酒店",
  ];
  if (segment.maxPrice && !overrides.ignoreMaxPrice) {
    args.push("--max-price", String(segment.maxPrice));
  }
  const usePoi = overrides.usePoi || segment.poiPrefer?.[0];
  if (usePoi && (overrides.usePoi || segment.segment?.includes("机场"))) {
    const poi = segment.poiPrefer?.find((p) => !["市区", "县城"].includes(p)) || segment.poiPrefer?.[0];
    if (poi) args.push("--poi-name", poi);
  }
  if (segment.keyWords || overrides.keyWords) {
    args.push("--key-words", segment.keyWords || overrides.keyWords);
  }
  if (segment.hotelStars || overrides.hotelStars) {
    args.push("--hotel-stars", segment.hotelStars || overrides.hotelStars);
  }
  const cmd = flyai.split(/\s+/);
  try {
    const out = execFileSync(cmd[0], [...cmd.slice(1), ...args], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      cwd: ROOT,
    });
    return JSON.parse(out.trim());
  } catch (e) {
    const stdout = e.stdout ? String(e.stdout) : "";
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
    const key = `${h.name}|${h.checkin}|${h.checkout}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

async function searchSegment(seg, elderFriendly) {
  const topN = seg.topN || 8;
  const rows = [];
  const pricePayload = runHotelSearch(seg, {
    sort: "price_asc",
    usePoi: seg.segment?.includes("机场") || seg.poiPrefer?.includes("喀赞其"),
  });
  if (pricePayload) rows.push(...mapHotels(seg, pricePayload, topN));

  if (elderFriendly) {
    const comfortPayload = runHotelSearch(seg, {
      sort: "rate_desc",
      hotelStars: seg.hotelStars || "4,5",
      usePoi: !!seg.poiPrefer?.[0],
      keyWords: seg.keyWords || "全季 星程 舒适",
      ignoreMaxPrice: false,
    });
    if (comfortPayload) rows.push(...mapHotels(seg, comfortPayload, topN));
    // Fallback: POI-only search when keyword+stars returns empty
    if (!rows.length && seg.poiPrefer?.[0]) {
      const poiPayload = runHotelSearch(seg, { sort: "rate_desc", usePoi: true });
      if (poiPayload) rows.push(...mapHotels(seg, poiPayload, topN));
    }
  }
  return dedupeHotels(rows);
}

function mapHotels(segment, payload, topN) {
  const list = payload?.data?.itemList || payload?.itemList || [];
  return list.slice(0, topN).map((h, i) => {
    const priceRaw = h.price || h.lowestPrice || "";
    const priceNum = parsePriceNum(priceRaw);
    return {
      segment: segment.segment,
      checkin: segment.checkIn,
      checkout: segment.checkOut,
      apiRank: i + 1,
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
  const cfg = loadConfig();
  const trip = profilePath
    ? loadTripProfile({ tripProfilePath: profilePath, focusMode: false })
    : cfg.trip;
  const segments = [...(trip.hotels || [])];
  const seen = new Set(segments.map((s) => s.segment));
  for (const variant of Object.values(trip.itineraryVariants || {})) {
    for (const seg of variant.hotels || []) {
      if (!seen.has(seg.segment)) {
        segments.push(seg);
        seen.add(seg.segment);
      }
    }
  }
  if (!segments.length) {
    process.stderr.write("No hotel segments in trip profile — skipping\n");
    return;
  }

  if (!process.env.FLYAI_API_KEY) {
    process.stderr.write("Warning: FLYAI_API_KEY not set — hotel prices may be trial/masked\n");
  }

  const elderFriendly = trip.scoringProfile === "family_elder";
  const all = [];
  for (const seg of segments) {
    process.stderr.write(`Hotels: ${seg.segment} → ${seg.destName} ${seg.checkIn}..${seg.checkOut}\n`);
    const rows = await searchSegment(seg, elderFriendly);
    all.push(...rows);
    process.stderr.write(`  → ${rows.length} candidates (price + comfort pool)\n`);
    await sleep(2500);
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
