/**
 * Phase 2 return route list: primary focusRoutes.inbound + returnAlternateOrigins.
 */

function resolveInboundFocusRoutes(trip, cfg) {
  const explicit = trip?.focusRoutes?.inbound || [];
  const alternates = trip?.returnAlternateOrigins || [];
  if (!explicit.length && !alternates.length) return [];

  const gdDest =
    explicit[0]?.dest || (cfg?.origins?.includes("广州") ? "广州" : cfg?.origins?.[0] || "广州");
  const dates =
    trip?.returnDateCompare?.length > 0
      ? trip.returnDateCompare
      : [...new Set(explicit.flatMap((r) => r.dates || []))];

  const expanded = explicit.map((r) => ({ ...r }));
  const seen = new Set(explicit.map((r) => r.origin));
  for (const origin of alternates) {
    if (!origin || seen.has(origin)) continue;
    expanded.push({
      origin,
      dest: gdDest,
      dates: dates.length ? [...dates] : [],
      alternate: true,
    });
    seen.add(origin);
  }
  return expanded;
}

function listReturnOriginAirports(trip, cfg) {
  return [...new Set(resolveInboundFocusRoutes(trip, cfg).map((r) => r.origin))];
}

module.exports = {
  resolveInboundFocusRoutes,
  listReturnOriginAirports,
};
