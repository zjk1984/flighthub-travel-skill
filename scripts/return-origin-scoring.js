/**
 * Return-flight origin scoring: when outbound is booked, score Xinjiang
 * departure airport by proximity to the outbound destination (anchor).
 */
const { parseRoute } = require("./load-monitor-config");

const DEFAULT_BY_ANCHOR = {
  伊宁: { 伊宁: 100, 博乐: 86, 乌鲁木齐: 82, 石河子: 74, 阿勒泰: 58 },
  乌鲁木齐: { 乌鲁木齐: 100, 石河子: 92, 伊宁: 85, 博乐: 78, 阿勒泰: 68 },
  阿勒泰: { 阿勒泰: 100, 乌鲁木齐: 72, 伊宁: 58, 石河子: 65, 博乐: 55 },
  博乐: { 博乐: 100, 伊宁: 88, 乌鲁木齐: 80, 石河子: 72, 阿勒泰: 52 },
  石河子: { 石河子: 100, 乌鲁木齐: 90, 伊宁: 76, 博乐: 70, 阿勒泰: 62 },
};

function isOutboundConfirmed(trip) {
  if (trip?.workflow?.confirmed?.outbound === true) return true;
  return !!trip?.bookedOutbound;
}

function getOutboundAnchor(trip) {
  if (trip?.returnOriginScores?.anchor) return trip.returnOriginScores.anchor;
  const route = trip?.bookedOutbound?.route;
  if (!route) return null;
  const { dest } = parseRoute(route);
  return dest || null;
}

function getScoreTable(anchor, trip, scoring) {
  if (
    trip?.returnOriginScores?.scores &&
    (!trip.returnOriginScores.anchor || trip.returnOriginScores.anchor === anchor)
  ) {
    return trip.returnOriginScores.scores;
  }
  const fromCfg = scoring?.returnOriginScoresByAnchor?.[anchor];
  if (fromCfg) return fromCfg;
  return DEFAULT_BY_ANCHOR[anchor] || null;
}

function returnOriginScore(airport, trip, scoring) {
  const anchor = getOutboundAnchor(trip);
  if (!anchor || !airport) return null;
  const table = getScoreTable(anchor, trip, scoring);
  if (table && table[airport] != null) return table[airport];
  if (airport === anchor) return 100;
  return 70;
}

function shouldUseReturnOriginScoring(trip, direction) {
  return direction === "inbound" && isOutboundConfirmed(trip) && !!getOutboundAnchor(trip);
}

function depCityPref(f, direction, trip, scoring) {
  if (shouldUseReturnOriginScoring(trip, direction)) {
    const anchor = getOutboundAnchor(trip);
    const pts = returnOriginScore(f.xjAirport, trip, scoring);
    return {
      pts: pts ?? 70,
      anchor,
      mode: "return_origin",
      labelAirport: f.xjAirport,
    };
  }
  const city = direction === "outbound" ? f.origin : f.dest;
  const pts = scoring.originScores[city] ?? 80;
  return {
    pts,
    anchor: null,
    mode: direction === "outbound" ? "outbound_origin" : "inbound_guangdong",
    labelAirport: city,
  };
}

function formatDepCityDeduction(meta, labelCity) {
  if (meta.mode === "return_origin") {
    const name = labelCity(meta.labelAirport);
    const anchorName = labelCity(meta.anchor);
    if (meta.pts >= 100) {
      return `返程出发 ${name}：偏好分 100（与去程目的地 ${anchorName} 一致）`;
    }
    return `返程出发 ${name}：偏好分 ${meta.pts}（相对去程目的地 ${anchorName} 100 分，按远近扣减）`;
  }
  if (meta.pts < 100) {
    return `出发/到达地 ${meta.labelAirport}：偏好分 ${meta.pts}（较深圳 100 扣 ${100 - meta.pts}）`;
  }
  return `出发/到达地 ${meta.labelAirport}：偏好分 100`;
}

module.exports = {
  DEFAULT_BY_ANCHOR,
  isOutboundConfirmed,
  getOutboundAnchor,
  returnOriginScore,
  shouldUseReturnOriginScoring,
  depCityPref,
  formatDepCityDeduction,
};
