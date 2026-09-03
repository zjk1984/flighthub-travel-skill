/**
 * Load optional trip profile (party size, focus routes, hotels, scoring).
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DEFAULT_PROFILE_PATH = path.join(ROOT, "config/trip-profile.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveProfilePath(cfg) {
  const raw = cfg?.tripProfilePath;
  if (!raw) return null;
  return path.isAbsolute(raw) ? raw : path.join(ROOT, raw);
}

function loadTripProfile(cfg) {
  const profilePath = resolveProfilePath(cfg);
  if (!profilePath || !fs.existsSync(profilePath)) {
    return {
      label: null,
      partySize: 1,
      scoringProfile: "default",
      focusMode: cfg?.focusMode === true,
      bookedOutbound: null,
      focusRoutes: null,
      returnDateCompare: [],
      hotels: [],
      profilePath: null,
    };
  }
  const raw = readJson(profilePath);
  return {
    label: raw.label || null,
    partySize: Math.max(1, parseInt(raw.partySize, 10) || 1),
    scoringProfile: raw.scoringProfile || "default",
    focusMode: raw.focusMode === true || cfg?.focusMode === true,
    bookedOutbound: raw.bookedOutbound || null,
    focusRoutes: raw.focusRoutes || null,
    returnDateCompare: Array.isArray(raw.returnDateCompare) ? raw.returnDateCompare : [],
    hotels: Array.isArray(raw.hotels) ? raw.hotels : [],
    profilePath,
  };
}

function buildFocusTasks(focusRoutes, direction, defaultMode = "full") {
  const routes = focusRoutes?.[direction] || [];
  const tasks = [];
  for (const r of routes) {
    const dates = r.dates || [];
    for (const date of dates) {
      tasks.push({
        origin: r.origin,
        dest: r.dest,
        date,
        mode: r.mode || defaultMode,
      });
    }
  }
  return tasks;
}

module.exports = {
  DEFAULT_PROFILE_PATH,
  loadTripProfile,
  buildFocusTasks,
  resolveProfilePath,
};
