/**
 * Hotel scoring profiles — mirrors flight v2 structure (weighted sub-scores, 0–100).
 */
const PROFILES = {
  default: {
    label: "默认（价格优先）",
    weights: {
      price: 0.35,
      location: 0.25,
      comfort: 0.20,
      review: 0.10,
      brand: 0.10,
    },
    elderFriendly: false,
  },
  family_elder: {
    label: "家庭·老人友好",
    weights: {
      price: 0.25,
      location: 0.25,
      comfort: 0.25,
      review: 0.10,
      brand: 0.15,
    },
    elderFriendly: true,
    preferredBrands: ["全季", "星程", "汉庭", "如家", "亚朵", "维也纳", "锦江"],
    avoidKeywords: ["青旅", "青年旅舍", "胶囊", "床位"],
  },
  budget: {
    label: "极致低价",
    weights: {
      price: 0.50,
      location: 0.15,
      comfort: 0.15,
      review: 0.10,
      brand: 0.10,
    },
    elderFriendly: false,
  },
};

const STAR_POINTS = {
  豪华型: 100,
  高档型: 95,
  舒适型: 90,
  三星级: 78,
  经济型: 65,
};

const DEFAULT_SEGMENT_POI = {
  "10/1 晚到": ["机场", "伊宁站", "火车站", "喀赞其"],
  "10/2-3 赛湖": ["赛里木", "博乐", "湖"],
  "10/4-5 那拉提": ["那拉提", "新源", "草原"],
  "10/6-7 回伊宁": ["机场", "伊宁站", "市区", "喀赞其"],
};

function getHotelProfile(name) {
  return PROFILES[name] || PROFILES.default;
}

function parsePriceNum(price) {
  if (typeof price === "number") return price;
  return parseFloat(String(price || "").replace(/[^0-9.]/g, "")) || 0;
}

function normalize(values) {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0);
  return values.map((v) => (v - min) / (max - min));
}

function pricePointsAbsolute(price) {
  if (price <= 0) return 50;
  if (price < 200) return 70;
  if (price < 350) return 85;
  if (price < 500) return 92;
  const tier = Math.floor(price / 500);
  return Math.max(40, 100 - tier * 15);
}

function pricePointsCombined(price, segmentPrices) {
  const abs = pricePointsAbsolute(price);
  if (segmentPrices.length < 2) return abs;
  const min = Math.min(...segmentPrices);
  const max = Math.max(...segmentPrices);
  if (max === min) return abs;
  const rel = Math.round((1 - (price - min) / (max - min)) * 100);
  return Math.round(abs * 0.5 + rel * 0.5);
}

function comfortPoints(star, profile, hotel, segmentMeta) {
  const s = String(star || "").trim();
  const name = `${hotel?.name || ""} ${hotel?.lodgingType || ""}`;
  for (const [key, pts] of Object.entries(STAR_POINTS)) {
    if (s.includes(key)) return pts;
  }
  if (/民宿|客栈|牧家乐| inn/i.test(s + name)) {
    if (segmentMeta?.preferHomestay) return profile?.elderFriendly ? 88 : 92;
    return profile?.elderFriendly ? 55 : 70;
  }
  return 75;
}

function reviewPoints(reviewScore) {
  const s = parseFloat(String(reviewScore || "").replace(/[^0-9.]/g, ""));
  if (!s || Number.isNaN(s)) return 75;
  if (s >= 4.8) return 100;
  if (s >= 4.5) return 92;
  if (s >= 4.0) return 85;
  if (s >= 3.5) return 70;
  return 55;
}

function curatedNameMatch(hotel, segmentMeta) {
  const curated = segmentMeta?.curatedName;
  if (!curated) return false;
  const name = `${hotel.name || ""}`;
  const key = curated.replace(/[（(].*$/, "").trim();
  if (name.includes(key) || key.includes(name)) return true;
  const short = key.slice(0, Math.min(6, key.length));
  return short.length >= 3 && name.includes(short);
}

function locationPoints(hotel, segmentMeta) {
  const poi = `${hotel.poi || ""} ${hotel.address || ""} ${hotel.name || ""}`;
  if (curatedNameMatch(hotel, segmentMeta)) return 100;
  const prefer =
    segmentMeta?.poiPrefer ||
    DEFAULT_SEGMENT_POI[hotel.segment] ||
    [];
  const scenic = segmentMeta?.scenicPoi
    ? (Array.isArray(segmentMeta.scenicPoi) ? segmentMeta.scenicPoi : [segmentMeta.scenicPoi])
    : [];
  if (scenic.length) {
    let scenicHits = 0;
    for (const kw of scenic) {
      if (poi.includes(kw)) scenicHits++;
    }
    if (scenicHits >= 1) return 100;
    if (/景区|风景名胜|草原|湖|画廊|牧家|山庄|营地|游客中心|别迭|喀夏加尔|乌拉斯台|315国道/.test(poi)) return 95;
    if (/赛里木湖路|博乐巨辉|时代酒店|灵壤|天祥|建材家具/.test(poi)) return 35;
    if (/县城|市区|镇工矿路|天马湖|文化广场|近昭苏|县人民政府/.test(poi)) return 40;
    return 55;
  }
  if (!prefer.length) return 80;
  let hits = 0;
  for (const kw of prefer) {
    if (poi.includes(kw)) hits++;
  }
  if (hits >= 2) return 100;
  if (hits === 1) return 88;
  return 65;
}

function brandPoints(name, profile) {
  const n = String(name || "");
  if (profile?.elderFriendly && profile.preferredBrands) {
    for (const b of profile.preferredBrands) {
      if (n.includes(b)) return 100;
    }
    for (const bad of profile.avoidKeywords || []) {
      if (n.includes(bad)) return 40;
    }
  }
  if (/宾馆|大酒店|国际酒店/.test(n)) return 85;
  return 75;
}

function nightsBetween(checkin, checkout) {
  const a = new Date(String(checkin));
  const b = new Date(String(checkout));
  if (isNaN(a) || isNaN(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86400000));
}

function roomCountForParty(partySize = 1, roomCount = null) {
  if (roomCount != null && roomCount > 0) return roomCount;
  return Math.max(1, Math.ceil(partySize / 2));
}

function scoreHotelsInSegment(hotels, profile, segmentMeta, partySize = 1, roomCount = null) {
  if (!hotels.length) return [];
  const rooms = roomCountForParty(partySize, roomCount);
  const prices = hotels.map((h) => h.priceNum);
  return hotels
    .map((h) => {
      const pricePts = pricePointsCombined(h.priceNum, prices);
      const locationPts = locationPoints(h, segmentMeta);
      const comfortPts = comfortPoints(h.star, profile, h, segmentMeta);
      const reviewPts = reviewPoints(h.reviewScore);
      const brandPts = brandPoints(h.name, profile);
      const w = profile.weights;
      const score =
        Math.round(
          ((pricePts / 100) * w.price +
            (locationPts / 100) * w.location +
            (comfortPts / 100) * w.comfort +
            (reviewPts / 100) * w.review +
            (brandPts / 100) * w.brand) *
            1000
        ) / 10;
      const nights = nightsBetween(h.checkin, h.checkout);
      return {
        ...h,
        pricePts,
        locationPts,
        comfortPts,
        reviewPts,
        brandPts,
        score,
        nights,
        roomEstimate: rooms,
        stayTotal: h.priceNum * nights * rooms,
        partySize,
        destName: segmentMeta?.destName || h.destName || "",
      };
    })
    .sort((a, b) => {
      if (segmentMeta?.preferHomestay || segmentMeta?.scenicHomestay) {
        const aHomestay = a.lodgingType === "民宿" || /民宿|客栈|牧家乐|山庄|营地|毡房/.test(a.name);
        const bHomestay = b.lodgingType === "民宿" || /民宿|客栈|牧家乐|山庄|营地|毡房/.test(b.name);
        if (aHomestay !== bHomestay) return aHomestay ? -1 : 1;
      }
      if (segmentMeta?.scenicHomestay) {
        const aCityHotel = /大酒店|时代酒店|云上酒店/.test(a.name) && !/民宿|牧家|山庄|毡房/.test(a.name);
        const bCityHotel = /大酒店|时代酒店|云上酒店/.test(b.name) && !/民宿|牧家|山庄|毡房/.test(b.name);
        if (aCityHotel !== bCityHotel) return aCityHotel ? 1 : -1;
        const aCurated = curatedNameMatch(a, segmentMeta);
        const bCurated = curatedNameMatch(b, segmentMeta);
        if (aCurated !== bCurated) return aCurated ? -1 : 1;
        if (a.locationPts !== b.locationPts) return b.locationPts - a.locationPts;
      }
      return b.score - a.score || a.priceNum - b.priceNum;
    });
}

function buildDeductions(h, profile) {
  const items = [];
  const w = profile?.weights || {};

  if (h.priceNum >= 500) {
    items.push(`价格 ¥${h.priceNum}/晚：较高档，绝对分偏低（价格分 ${h.pricePts}，权重 ${Math.round((w.price || 0) * 100)}%）`);
  } else if (h.priceNum < 200) {
    items.push(`价格 ¥${h.priceNum}/晚：低价档（价格分 ${h.pricePts}）`);
  } else {
    items.push(`价格 ¥${h.priceNum}/晚：综合价分 ${h.pricePts}（绝对+同段相对各 50%）`);
  }

  if (h.locationPts >= 100) {
    items.push(`位置 ${h.poi || "—"}：命中分段 POI 偏好（位置分 100）`);
  } else if (h.locationPts >= 88) {
    items.push(`位置 ${h.poi || "—"}：部分匹配 POI（位置分 ${h.locationPts}，较满分扣 ${100 - h.locationPts}）`);
  } else {
    items.push(`位置 ${h.poi || "—"}：未命中分段 POI 关键词（位置分 ${h.locationPts}，较满分扣 ${100 - h.locationPts}）`);
  }

  if (h.comfortPts >= 90) {
    items.push(`档次 ${h.star || "—"}：舒适度分 ${h.comfortPts}（较优）`);
  } else {
    items.push(`档次 ${h.star || "—"}：舒适度分 ${h.comfortPts}（老人出行建议舒适型及以上）`);
  }

  if (h.reviewScore) {
    items.push(`平台评分 ${h.reviewScore}：口碑分 ${h.reviewPts}`);
  } else {
    items.push(`口碑：无评分数据，默认 ${h.reviewPts} 分`);
  }

  if (h.brandPts >= 100) {
    items.push(`品牌：连锁/优选品牌（品牌分 100）`);
  } else if (h.brandPts <= 50) {
    items.push(`品牌：含青旅/胶囊等关键词，老人画像扣分（品牌分 ${h.brandPts}）`);
  } else {
    items.push(`品牌/类型：品牌分 ${h.brandPts}`);
  }

  if (h.nights > 1) {
    items.push(
      `连住 ${h.nights} 晚 × ${h.roomEstimate} 间 ≈ ¥${h.stayTotal.toFixed(0)}（${h.roomEstimate} 间估算，${h.partySize || "?"} 人）`
    );
  } else if (h.roomEstimate > 1) {
    items.push(`单晚 × ${h.roomEstimate} 间 ≈ ¥${h.stayTotal.toFixed(0)}（${h.roomEstimate} 间估算）`);
  }

  return items;
}

module.exports = {
  PROFILES,
  DEFAULT_SEGMENT_POI,
  getHotelProfile,
  parsePriceNum,
  roomCountForParty,
  scoreHotelsInSegment,
  buildDeductions,
  pricePointsAbsolute,
  locationPoints,
  comfortPoints,
  curatedNameMatch,
};
