/**
 * Google Places API (New) lodging search — supplements fly.ai with Maps listings.
 *
 * Requires GOOGLE_PLACES_API_KEY (Places API New enabled).
 */
const DEFAULT_SEGMENT_GEO = {
  尼勒克: { lat: 43.682, lng: 83.275, radiusM: 35000 },
  博乐: { lat: 44.903, lng: 82.072, radiusM: 50000 },
  特克斯: { lat: 43.217, lng: 81.835, radiusM: 40000 },
  昭苏: { lat: 43.157, lng: 81.126, radiusM: 35000 },
  伊宁: { lat: 43.909, lng: 81.277, radiusM: 25000 },
};

const PRICE_LEVEL_ESTIMATE = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 150,
  PRICE_LEVEL_MODERATE: 350,
  PRICE_LEVEL_EXPENSIVE: 650,
  PRICE_LEVEL_VERY_EXPENSIVE: 1200,
};

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.googleMapsUri",
  "places.primaryType",
  "places.types",
  "places.location",
  "places.priceLevel",
  "places.businessStatus",
].join(",");

function getApiKey() {
  return process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "";
}

function getSegmentGeo(seg) {
  if (seg.googleLocation?.lat != null && seg.googleLocation?.lng != null) {
    return {
      lat: seg.googleLocation.lat,
      lng: seg.googleLocation.lng,
      radiusM: seg.googleLocation.radiusM || 35000,
    };
  }
  const scenic = seg.scenicPoi
    ? Array.isArray(seg.scenicPoi)
      ? seg.scenicPoi
      : [seg.scenicPoi]
    : [];
  if (scenic.some((s) => /赛里木湖|赛湖/.test(s))) {
    return { lat: 44.622, lng: 81.348, radiusM: 28000 };
  }
  if (/唐布拉|百里画廊/.test(seg.segment || "")) {
    return { lat: 43.682, lng: 83.275, radiusM: 35000 };
  }
  return DEFAULT_SEGMENT_GEO[seg.destName] || { lat: 43.9, lng: 81.3, radiusM: 40000 };
}

function buildGoogleQueries(seg) {
  const queries = new Set();
  const dest = seg.destName || "";
  const scenic = seg.scenicPoi
    ? Array.isArray(seg.scenicPoi)
      ? seg.scenicPoi.join(" ")
      : seg.scenicPoi
    : "";
  const keywords = seg.keyWords || "";

  if (seg.scenicHomestay || seg.preferHomestay) {
    queries.add(`${scenic || keywords || dest} 民宿`.trim());
    queries.add(`${scenic || keywords || dest} 客栈`.trim());
  }
  queries.add(`${keywords || scenic || dest} 酒店`.trim());
  queries.add(`${dest} ${scenic} lodging`.trim());

  for (const extra of seg.extraKeywordSearches || []) {
    if (extra.keyWords) queries.add(extra.keyWords);
  }

  if (seg.segment?.includes("博乐") && !seg.scenicHomestay) {
    queries.add("博乐 全季 亚朵 友好商圈 酒店");
    queries.add("博乐阿拉山口机场 酒店");
  }

  return [...queries].filter((q) => q.length >= 4).slice(0, 6);
}

function normalizeHotelName(name) {
  return String(name || "")
    .replace(/\s/g, "")
    .replace(/[（()）·・]/g, "")
    .replace(/(民宿|客栈|酒店|宾馆|山庄|营地|度假村)$/g, "")
    .toLowerCase();
}

function namesLikelySame(a, b) {
  const na = normalizeHotelName(a);
  const nb = normalizeHotelName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const short = na.length <= nb.length ? na : nb;
  const long = na.length <= nb.length ? nb : na;
  return short.length >= 4 && long.includes(short);
}

function inferLodgingType(place) {
  const types = place.types || [];
  const name = place.displayName?.text || "";
  if (/民宿|客栈|牧家乐|毡房|营地|山庄|guesthouse/i.test(name)) return "民宿";
  if (types.includes("guest_house") || types.includes("bed_and_breakfast")) return "民宿";
  return "酒店";
}

function priceLevelToEstimate(priceLevel) {
  if (!priceLevel || priceLevel === "PRICE_LEVEL_UNSPECIFIED") return 0;
  return PRICE_LEVEL_ESTIMATE[priceLevel] || 0;
}

function starFromPriceLevel(priceLevel, lodgingType) {
  const est = priceLevelToEstimate(priceLevel);
  if (est >= 650) return "高档型";
  if (est >= 350) return "舒适型";
  if (lodgingType === "民宿") return "舒适型";
  return est > 0 ? "经济型" : "—";
}

async function searchGooglePlacesText(textQuery, geo, maxResultCount = 12) {
  const apiKey = getApiKey();
  if (!apiKey) return [];

  const body = {
    textQuery,
    languageCode: "zh-CN",
    maxResultCount,
    locationBias: {
      circle: {
        center: { latitude: geo.lat, longitude: geo.lng },
        radius: geo.radiusM,
      },
    },
  };

  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Places ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.places || [];
}

function mapGooglePlace(segment, place, rank, searchQuery) {
  const name = place.displayName?.text || "—";
  const lodgingType = inferLodgingType(place);
  const priceEst = priceLevelToEstimate(place.priceLevel);
  const rating = place.rating != null ? String(place.rating) : null;
  const reviewCount = place.userRatingCount || 0;

  return {
    segment: segment.segment,
    checkin: segment.checkIn,
    checkout: segment.checkOut,
    apiRank: rank,
    lodgingType,
    searchPoi: searchQuery || "",
    name,
    price: priceEst > 0 ? `≈¥${priceEst}` : "—",
    priceNum: priceEst,
    priceIsEstimate: priceEst > 0,
    star: starFromPriceLevel(place.priceLevel, lodgingType),
    brandName: "",
    poi: place.formattedAddress || "—",
    address: place.formattedAddress || "",
    reviewScore: rating,
    reviewDesc: reviewCount > 0 ? `${reviewCount}条 Google 评价` : "Google Places",
    url: place.googleMapsUri || "",
    source: "google",
    googlePlaceId: place.id || "",
    latitude: place.location?.latitude,
    longitude: place.location?.longitude,
  };
}

async function searchSegmentGooglePlaces(seg, topN = 12) {
  const apiKey = getApiKey();
  if (!apiKey || seg.skipMonitor || seg.googlePlaces === false) return [];

  const geo = getSegmentGeo(seg);
  const queries = buildGoogleQueries(seg);
  const seen = new Set();
  const rows = [];

  for (const query of queries) {
    try {
      const places = await searchGooglePlacesText(query, geo, topN);
      for (const place of places) {
        const id = place.id || normalizeHotelName(place.displayName?.text);
        if (seen.has(id)) continue;
        seen.add(id);
        rows.push(mapGooglePlace(seg, place, rows.length + 1, query));
      }
    } catch (err) {
      process.stderr.write(`Google Places failed (${seg.segment}, "${query}"): ${err.message}\n`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  return rows.slice(0, topN * 2);
}

function mergeHotelSources(flyaiRows, googleRows) {
  const rows = [];

  const findIndex = (h) =>
    rows.findIndex((prev) => namesLikelySame(prev.name, h.name));

  const upsert = (h) => {
    if (!h.name) return;
    const idx = findIndex(h);
    if (idx < 0) {
      rows.push({ ...h, sources: [h.source || "flyai"] });
      return;
    }
    const prev = rows[idx];

    const prevSources = new Set(prev.sources || [prev.source || "flyai"]);
    prevSources.add(h.source || "google");
    const merged = {
      ...prev,
      sources: [...prevSources],
      source: prevSources.size > 1 ? "both" : prev.source,
    };

    const prevHasPrice = prev.priceNum > 0 && !prev.priceIsEstimate;
    const curHasPrice = h.priceNum > 0 && !h.priceIsEstimate;
    if (!prevHasPrice && curHasPrice) {
      merged.price = h.price;
      merged.priceNum = h.priceNum;
      merged.priceIsEstimate = false;
      merged.url = h.url || prev.url;
      merged.star = h.star !== "—" ? h.star : prev.star;
    } else if (prevHasPrice && !curHasPrice) {
      merged.reviewScore = prev.reviewScore || h.reviewScore;
      merged.reviewDesc = prev.reviewDesc || h.reviewDesc;
      merged.url = prev.url || h.url;
    } else {
      merged.reviewScore = prev.reviewScore || h.reviewScore;
      merged.url = prev.url || h.url;
    }

    if (h.googlePlaceId && !merged.googlePlaceId) merged.googlePlaceId = h.googlePlaceId;
    if (h.latitude && !merged.latitude) {
      merged.latitude = h.latitude;
      merged.longitude = h.longitude;
    }
    rows[idx] = merged;
  };

  for (const h of flyaiRows) upsert(h);
  for (const h of googleRows) upsert(h);
  return rows;
}

module.exports = {
  getApiKey,
  getSegmentGeo,
  buildGoogleQueries,
  normalizeHotelName,
  namesLikelySame,
  priceLevelToEstimate,
  searchGooglePlacesText,
  searchSegmentGooglePlaces,
  mapGooglePlace,
  mergeHotelSources,
};
