#!/usr/bin/env node
/**
 * Daily Feishu digest for trip bookings: pending items + booking deadlines.
 *
 * Usage:
 *   node booking-reminders.js [--date YYYY-MM-DD] [--dry-run] [--force]
 *   node booking-reminders.js --mode eve   # legacy: 1 day before event only
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
  const args = { date: null, dryRun: false, force: false, mode: "daily" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date" && argv[i + 1]) args.date = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--force") args.force = true;
    else if (a === "--mode" && argv[i + 1]) args.mode = argv[++i];
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

function daysBetween(from, to) {
  const a = new Date(`${from}T12:00:00`);
  const b = new Date(`${to}T12:00:00`);
  return Math.round((b - a) / 86400000);
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

function reserveTime(item) {
  return item.bookTime || item.appointmentTime || "";
}

/** Days until next booking milestone (open → deadline → event). */
function remainingDays(item, today) {
  if (item.bookFromDate && today < item.bookFromDate) {
    return daysBetween(today, item.bookFromDate);
  }
  if (item.bookByDate) {
    return daysBetween(today, item.bookByDate);
  }
  return daysBetween(today, item.eventDate);
}

function isBeforeBookOpen(item, today) {
  return Boolean(item.bookFromDate && today < item.bookFromDate);
}

function makeRemainingSorter(today) {
  return (a, b) => {
    const diff = remainingDays(a, today) - remainingDays(b, today);
    if (diff !== 0) return diff;
    const aTime = reserveTime(a);
    const bTime = reserveTime(b);
    if (aTime !== bTime) return aTime.localeCompare(bTime);
    if (a.eventDate !== b.eventDate) return a.eventDate.localeCompare(b.eventDate);
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  };
}

function sortByRemainingDays(items, today) {
  return [...items].sort(makeRemainingSorter(today));
}

function sortItems(a, b) {
  return makeRemainingSorter("9999-12-31")(a, b);
}

function isActive(item, today) {
  return item.eventDate >= today;
}

function itemsForRemindDate(schedule, remindDate) {
  const lead = schedule.remindDaysBefore ?? 1;
  return schedule.items
    .filter((item) => addDays(item.eventDate, -lead) === remindDate)
    .sort(sortItems);
}

function selectDailyDigest(items, today, schedule) {
  const lookAhead = schedule.lookAheadDays ?? 7;
  const lead = schedule.remindDaysBefore ?? 1;
  const active = items.filter((i) => isActive(i, today));

  const sortRemaining = makeRemainingSorter(today);
  const pending = sortByRemainingDays(active.filter((i) => !i.booked), today);

  const overdue = sortByRemainingDays(
    pending.filter((i) => i.bookByDate && i.bookByDate < today),
    today
  );

  const dueToday = sortByRemainingDays(
    active.filter((i) => {
      if (i.bookByDate === today && !i.booked) return true;
      if (addDays(i.eventDate, -lead) === today) return true;
      if (!i.booked && i.eventDate === today) return true;
      return false;
    }),
    today
  );

  const bookingWindow = sortByRemainingDays(
    pending.filter((i) => {
      if (!i.bookFromDate && !i.bookByDate) return false;
      const from = i.bookFromDate || today;
      const by = i.bookByDate || i.eventDate;
      if (today < from || today > by) return false;
      if (i.bookByDate && daysBetween(today, i.bookByDate) <= lookAhead) return true;
      return Boolean(i.bookFromDate && i.bookFromDate <= today);
    }),
    today
  );

  const tomorrow = addDays(today, 1);
  const tomorrowPrep = [...active.filter((i) => i.eventDate === tomorrow)].sort(sortRemaining);

  const hasContent =
    pending.length > 0 ||
    dueToday.length > 0 ||
    overdue.length > 0 ||
    bookingWindow.length > 0 ||
    tomorrowPrep.some((i) => !i.booked || addDays(i.eventDate, -lead) === today);

  return { pending, overdue, dueToday, bookingWindow, tomorrowPrep, hasContent };
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

function formatReserveTime(item) {
  if (item.appointmentTime && item.appointmentEnd) {
    return `${formatEventDate(item.eventDate)} ${item.appointmentTime}–${item.appointmentEnd}`;
  }
  if (item.appointmentTime) {
    return `${formatEventDate(item.eventDate)} ${item.appointmentTime}`;
  }
  if (item.bookTime && item.bookByDate) {
    return `${formatEventDate(item.bookByDate)} ${item.bookTime}`;
  }
  if (item.bookByDate) return formatEventDate(item.bookByDate);
  return formatEventDate(item.eventDate);
}

function formatRemainingLabel(item, today) {
  const left = remainingDays(item, today);
  const timeSuffix = item.bookTime ? ` ${item.bookTime}` : "";
  if (left < 0) return `**已逾期 ${Math.abs(left)} 天**`;
  if (isBeforeBookOpen(item, today)) {
    if (left === 0) return "**今日开放预约**";
    return `距开放 ${formatEventDate(item.bookFromDate)} **剩 ${left} 天**`;
  }
  if (item.bookByDate) {
    if (left === 0) return `**今日截止${timeSuffix}**`;
    return `距截止 ${formatEventDate(item.bookByDate)}${timeSuffix} **剩 ${left} 天**`;
  }
  if (left === 0) return "**今日行程**";
  return `距行程 ${formatEventDate(item.eventDate)} **剩 ${left} 天**`;
}

function formatBookWindow(item, today) {
  const parts = [formatRemainingLabel(item, today)];
  if (item.bookFromDate) parts.push(`开放 ${formatEventDate(item.bookFromDate)}`);
  if (item.bookByDate && !isBeforeBookOpen(item, today)) {
    const timeSuffix = item.bookTime ? ` ${item.bookTime}` : "";
    parts.push(`截止 ${formatEventDate(item.bookByDate)}${timeSuffix}`);
  }
  if (item.appointmentTime) {
    const slot = item.appointmentEnd
      ? `${item.appointmentTime}–${item.appointmentEnd}`
      : item.appointmentTime;
    parts.push(`预约时段 ${formatEventDate(item.eventDate)} ${slot}`);
  }
  return parts.join(" · ");
}

function renderItem(item, today, idx) {
  const emoji = CATEGORY_EMOJI[item.category] || "•";
  const status = item.booked ? "✅ 已订" : "⏳ 待办";
  const lines = [`**${idx}. ${emoji} ${status} · ${item.title}**`];
  lines.push(`🕐 预约 **${formatReserveTime(item)}** · 行程 **${formatEventDate(item.eventDate)}**`);
  const window = formatBookWindow(item, today);
  if (window) lines.push(`📌 预订 ${window}`);
  if (item.detail) lines.push(item.detail);
  if (item.action) lines.push(`👉 ${item.action}`);
  if (item.url) lines.push(`🔗 ${item.url}`);
  return lines.join("\n");
}

function buildDailyMarkdown(schedule, today, digest) {
  const hour = schedule.dailyDigestHour ?? 7;
  const pendingCount = digest.pending.length;
  const lines = [
    `**${schedule.label || "行程预订提醒"}**`,
    "",
    `⏰ **${formatEventDate(today)} ${hour}:00** 每日 digest · ${schedule.timezone || "Asia/Shanghai"}`,
    `待办 **${pendingCount}** 项 · 今日关注 **${digest.dueToday.length}** 项`,
    "",
    "---",
    "",
  ];

  if (digest.overdue.length) {
    lines.push("### 🔴 已逾期（请立即处理）", "");
    digest.overdue.forEach((item, i) => {
      lines.push(renderItem(item, today, i + 1), "");
    });
    lines.push("---", "");
  }

  if (digest.dueToday.length) {
    lines.push("### ⚡ 今日必办 / 明日行程准备", "");
    digest.dueToday.forEach((item, i) => {
      lines.push(renderItem(item, today, i + 1), "");
    });
    lines.push("---", "");
  }

  if (digest.bookingWindow.length) {
    lines.push("### 📅 预订窗口内（按截止时间排序）", "");
    digest.bookingWindow.forEach((item, i) => {
      lines.push(renderItem(item, today, i + 1), "");
    });
    lines.push("---", "");
  }

  if (digest.pending.length) {
    lines.push("### 📋 全部待办（按剩余时间 ↑）", "");
    digest.pending.forEach((item, i) => {
      lines.push(renderItem(item, today, i + 1), "");
    });
    lines.push("---", "");
  }

  if (digest.tomorrowPrep.length) {
    lines.push(`### 🌅 明日 ${formatEventDate(addDays(today, 1))} 行程一览`, "");
    digest.tomorrowPrep.forEach((item, i) => {
      lines.push(renderItem(item, today, i + 1), "");
    });
    lines.push("---", "");
  }

  lines.push(`提前 **${schedule.remindDaysBefore ?? 1}** 天行程提醒 · 每日 **${hour}:00** 推送`);
  return lines.join("\n");
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
    lines.push(renderItem(item, remindDate, idx + 1), "");
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
  const today = args.date || todayInTimezone(tz);

  let items = mergeProfileHotels(schedule.items, trip);

  if (args.mode === "eve") {
    items = itemsForRemindDate({ ...schedule, items }, today);
    if (!items.length) {
      console.error(`No eve reminders for ${today}`);
      return;
    }
    const markdown = buildMarkdown(schedule, today, items);
    const eventDates = [...new Set(items.map((i) => i.eventDate))].sort();
    const title = `${schedule.label || "行程"} · 预订提醒 · ${eventDates.map(formatEventDate).join("/")}`;
    if (args.dryRun) {
      console.log(markdown);
      return;
    }
    const stateKey = `eve:${today}:${eventDates.join(",")}`;
    await sendAndRecord({ stateKey, title, markdown, args, meta: { itemIds: items.map((i) => i.id) } });
    return;
  }

  const digest = selectDailyDigest(items, today, schedule);
  if (!digest.hasContent) {
    console.error(`[booking-reminders] ${today} nothing pending — skip`);
    return;
  }

  const markdown = buildDailyMarkdown(schedule, today, digest);
  const title = `${schedule.label || "行程"} · 每日预订提醒 · ${formatEventDate(today)}`;
  console.error(
    `[booking-reminders] daily ${today} pending=${digest.pending.length} due=${digest.dueToday.length}`
  );

  if (args.dryRun) {
    console.log(markdown);
    return;
  }

  const stateKey = `daily:${today}`;
  await sendAndRecord({
    stateKey,
    title,
    markdown,
    args,
    meta: {
      pending: digest.pending.length,
      dueToday: digest.dueToday.length,
    },
  });
}

async function sendAndRecord({ stateKey, title, markdown, args, meta }) {
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
  state[stateKey] = { sentAt: new Date().toISOString(), ...meta };
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
  daysBetween,
  itemsForRemindDate,
  mergeProfileHotels,
  selectDailyDigest,
  sortByRemainingDays,
  remainingDays,
  makeRemainingSorter,
  buildDailyMarkdown,
  buildMarkdown,
  loadSchedule,
  loadState,
  saveState,
  todayInTimezone,
  formatBookWindow,
  formatRemainingLabel,
  formatReserveTime,
  reserveTime,
  isBeforeBookOpen,
};
