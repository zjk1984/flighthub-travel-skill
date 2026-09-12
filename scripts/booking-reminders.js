#!/usr/bin/env node
/**
 * Send Feishu reminders for trip bookings one day before each event date.
 *
 * Usage:
 *   node booking-reminders.js [--date YYYY-MM-DD] [--dry-run] [--force]
 *   npm run remind:bookings
 */
const fs = require("fs");
const path = require("path");
const { loadTripProfile } = require("./load-trip-profile");
const { loadConfig } = require("./load-monitor-config");
const { resolveFeishuTransport, sendFeishuReport } = require("./feishu-notify");

const ROOT = path.join(__dirname, "..");
const SCHEDULE_PATH = path.join(ROOT, "config/booking-schedule.json");
const STATE_PATH = path.join(ROOT, "reports/.booking-reminders-state.json");

const CATEGORY_EMOJI = {
  hotel: "🏨",
  ticket: "🎫",
  car: "🚗",
  flight: "✈️",
  reservation: "📋",
  road: "🛣️",
  activity: "📍",
};

function parseArgs(argv) {
  const args = { date: null, dryRun: false, force: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date" && argv[i + 1]) args.date = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--force") args.force = true;
  }
  return args;
}

function todayInTimezone(tz) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(dateStr, delta) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function loadSchedule() {
  if (!fs.existsSync(SCHEDULE_PATH)) {
    throw new Error(`Missing schedule: ${SCHEDULE_PATH}`);
  }
  return JSON.parse(fs.readFileSync(SCHEDULE_PATH, "utf8"));
}

function mergeProfileHotels(items, trip) {
  const overrides = trip.hotelOverrides || {};
  return items.map((item) => {
    if (!item.profileCheckIn || !overrides[item.profileCheckIn]) return { ...item };
    const ov = overrides[item.profileCheckIn];
    return {
      ...item,
      title: item.title.replace(/· .+$/, "") + ` · ${ov.name}`,
      booked: ov.booked === true ? true : item.booked,
      url: ov.url || item.url,
      detail: ov.note || item.detail,
    };
  });
}

function itemsForRemindDate(schedule, remindDate) {
  const lead = schedule.remindDaysBefore ?? 1;
  return schedule.items
    .filter((item) => addDays(item.eventDate, -lead) === remindDate)
    .sort((a, b) => {
      if (a.eventDate !== b.eventDate) return a.eventDate.localeCompare(b.eventDate);
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });
}

function loadState(statePath = STATE_PATH) {
  if (!fs.existsSync(statePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state, statePath = STATE_PATH) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function formatEventDate(dateStr) {
  const [, m, d] = dateStr.split("-");
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}

function buildMarkdown(schedule, remindDate, items) {
  const eventDates = [...new Set(items.map((i) => i.eventDate))].sort();
  const eventLabel = eventDates.map(formatEventDate).join("、");
  const pending = items.filter((i) => !i.booked).length;
  const lines = [
    `**${schedule.label || "行程预订提醒"}**`,
    "",
    `📅 **提醒日** ${formatEventDate(remindDate)} → **行程日** ${eventLabel}`,
    `共 **${items.length}** 项（待办 **${pending}**）`,
    "",
    "---",
    "",
  ];

  items.forEach((item, idx) => {
    const emoji = CATEGORY_EMOJI[item.category] || "•";
    const status = item.booked ? "✅ 已订" : "⏳ 待办";
    lines.push(`**${idx + 1}. ${emoji} ${status} · ${item.title}**`);
    if (item.detail) lines.push(`${item.detail}`);
    if (item.action) lines.push(`👉 ${item.action}`);
    if (item.url) lines.push(`🔗 ${item.url}`);
    lines.push("");
  });

  lines.push("---");
  lines.push(`⏰ 提前 **${schedule.remindDaysBefore ?? 1}** 天提醒 · ${schedule.timezone || "Asia/Shanghai"}`);
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv);
  const schedule = loadSchedule();
  const cfg = loadConfig();
  const trip = loadTripProfile(cfg);
  const tz = schedule.timezone || "Asia/Shanghai";
  const remindDate = args.date || todayInTimezone(tz);

  let items = mergeProfileHotels(schedule.items, trip);
  items = itemsForRemindDate(schedule, remindDate);

  if (!items.length) {
    console.error(`No booking reminders for remind-date ${remindDate} (event +${schedule.remindDaysBefore ?? 1}d)`);
    return;
  }

  const markdown = buildMarkdown(schedule, remindDate, items);
  const eventDates = [...new Set(items.map((i) => i.eventDate))].sort();
  const title = `${schedule.label || "行程"} · 预订提醒 · ${eventDates.map(formatEventDate).join("/")}`;

  console.error(`[booking-reminders] ${remindDate} → ${items.length} item(s) for ${eventDates.join(", ")}`);

  if (args.dryRun) {
    console.log(markdown);
    return;
  }

  const stateKey = `${remindDate}:${eventDates.join(",")}`;
  const state = loadState();
  if (!args.force && state[stateKey]?.sentAt) {
    console.error(`Already sent at ${state[stateKey].sentAt}; use --force to resend`);
    return;
  }

  const transport = resolveFeishuTransport();
  if (!transport) {
    console.error("Feishu not configured. Set FEISHU_WEBHOOK_URL or FEISHU_APP_ID/SECRET/CHAT_ID");
    process.exit(1);
  }

  await sendFeishuReport(transport, markdown, { title, maxBytes: 20000 });
  state[stateKey] = {
    sentAt: new Date().toISOString(),
    itemIds: items.map((i) => i.id),
    eventDates,
  };
  saveState(state);
  console.error(`Feishu booking reminder sent: ${title}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = {
  addDays,
  itemsForRemindDate,
  mergeProfileHotels,
  buildMarkdown,
  loadSchedule,
  loadState,
  saveState,
  todayInTimezone,
};
