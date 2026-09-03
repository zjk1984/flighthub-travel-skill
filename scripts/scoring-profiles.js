/**
 * Scoring profile presets for flight ranking.
 */
const PROFILES = {
  default: {
    label: "默认（价格优先）",
    weights: {
      price: 0.35,
      duration: 0.15,
      transfer: 0.20,
      depCity: 0.10,
      depTime: 0.10,
      arrTime: 0.10,
    },
    elderFriendly: false,
  },
  family_elder: {
    label: "家庭·老人友好",
    weights: {
      price: 0.28,
      duration: 0.12,
      transfer: 0.28,
      depCity: 0.08,
      depTime: 0.12,
      arrTime: 0.12,
    },
    elderFriendly: true,
    depHourIdeal: [8, 11],
    depHourAvoidBefore: 6,
    arrHourPenalizeAfter: 23,
    penalizeRedEyeDeparture: true,
    bonusNextMorningArrival: 8,
  },
  budget: {
    label: "极致低价",
    weights: {
      price: 0.50,
      duration: 0.10,
      transfer: 0.15,
      depCity: 0.08,
      depTime: 0.08,
      arrTime: 0.09,
    },
    elderFriendly: false,
  },
};

function getProfile(name) {
  return PROFILES[name] || PROFILES.default;
}

function listProfiles() {
  return Object.entries(PROFILES).map(([id, p]) => ({ id, label: p.label }));
}

function timeSlotPoints(dateTimeStr, profile) {
  const hour = parseInt(String(dateTimeStr || "").slice(11, 13), 10);
  if (Number.isNaN(hour)) return 75;

  if (profile?.elderFriendly) {
    const ideal = profile.depHourIdeal || [8, 11];
    if (hour >= ideal[0] && hour <= ideal[1]) return 100;
    if (hour >= 10 && hour <= 20) return 95;
    if (profile.penalizeRedEyeDeparture && hour < (profile.depHourAvoidBefore ?? 6)) return 60;
    if (hour > (profile.arrHourPenalizeAfter ?? 23)) return 65;
    if (hour >= 6 && hour < ideal[0]) return 85;
    return 80;
  }

  if (hour >= 7 && hour < 10) return 100;
  if (hour >= 10 && hour <= 20) return 100;
  if (hour > 20 && hour <= 22) return 95;
  return 75;
}

function arrTimeSlotPoints(f, profile) {
  const base = timeSlotPoints(f.arrDateTime, profile);
  if (!profile?.elderFriendly || !profile.bonusNextMorningArrival) return base;

  const depDay = String(f.depDateTime || "").slice(0, 10);
  const arrDay = String(f.arrDateTime || "").slice(0, 10);
  if (depDay && arrDay && depDay !== arrDay) {
    const arrHour = parseInt(f.arrDateTime.slice(11, 13), 10);
    if (arrHour >= 6 && arrHour <= 12) return Math.max(base, 100);
  }
  return base;
}

function isSameDayArrival(f) {
  const depDay = String(f.depDateTime || "").slice(0, 10);
  const arrDay = String(f.arrDateTime || "").slice(0, 10);
  return depDay && arrDay && depDay === arrDay;
}

function pickScenario(flights, scenario, profile) {
  const verified = flights.filter((f) => f.priceVerified !== false);
  if (!verified.length) return null;

  if (scenario === "cheapest") {
    return [...verified].sort((a, b) => a.priceNum - b.priceNum)[0];
  }
  if (scenario === "same_day") {
    const sameDay = verified.filter(isSameDayArrival);
    if (!sameDay.length) return null;
    return [...sameDay].sort((a, b) => a.priceNum - b.priceNum)[0];
  }
  if (scenario === "elder") {
    const scored = verified.map((f) => ({
      ...f,
      elderScore:
        arrTimeSlotPoints(f, profile) * 0.4 +
        timeSlotPoints(f.depDateTime, profile) * 0.3 +
        (f.transfers === 0 ? 100 : f.transfers === 1 ? 70 : 40) * 0.3,
    }));
    return scored.sort((a, b) => b.elderScore - a.elderScore || a.priceNum - b.priceNum)[0];
  }
  return null;
}

module.exports = {
  PROFILES,
  getProfile,
  listProfiles,
  timeSlotPoints,
  arrTimeSlotPoints,
  isSameDayArrival,
  pickScenario,
};
