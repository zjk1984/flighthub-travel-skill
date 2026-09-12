const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../load-monitor-config');
const { loadTripProfile } = require('../load-trip-profile');
const {
  loadSchedule,
  mergeProfileHotels,
  itemsForRemindDate,
  selectDailyDigest,
  isDigestItem,
  sortByRemainingDays,
  remainingDays,
  buildDailyMarkdown,
  loadState,
  saveState,
  formatBookWindow,
  formatReserveTime,
  formatRemainingLabel,
  isBeforeBookOpen,
} = require('../booking-reminders.js');

const ROOT = path.join(__dirname, '..', '..');

test('selectDailyDigest lists pending and booking windows', () => {
  const schedule = loadSchedule();
  const trip = loadTripProfile(loadConfig());
  const items = mergeProfileHotels(schedule.items, trip);
  const digest = selectDailyDigest(items, '2026-09-30', schedule);
  assert.ok(digest.pending.length >= 5);
  assert.ok(digest.bookingWindow.some((i) => i.id === 'd7-sayram-ticket'));
  assert.ok(digest.hasContent);
});

test('selectDailyDigest flags overdue bookByDate', () => {
  const schedule = loadSchedule();
  const trip = loadTripProfile(loadConfig());
  const items = mergeProfileHotels(schedule.items, trip);
  const digest = selectDailyDigest(items, '2026-10-03', schedule);
  const overdueIds = digest.overdue.map((i) => i.id);
  assert.ok(overdueIds.includes('d2-yuhu-ticket') || overdueIds.includes('d3-kalajun-ticket'));
});

test('itemsForRemindDate picks items one day before event', () => {
  const schedule = loadSchedule();
  const items = itemsForRemindDate(schedule, '2026-10-06');
  assert.ok(items.some((i) => i.id === 'd7-sayram-ticket'));
  assert.ok(items.some((i) => i.id === 'd7-lake'));
});

test('remainingDays uses bookFromDate before window opens', () => {
  const schedule = loadSchedule();
  const sayram = schedule.items.find((i) => i.id === 'd7-sayram-ticket');
  assert.equal(remainingDays(sayram, '2026-09-12'), 17);
  assert.equal(isBeforeBookOpen(sayram, '2026-09-12'), true);
  assert.match(formatRemainingLabel(sayram, '2026-09-12'), /距开放.*剩 17 天/);
});

test('remainingDays uses bookByDate after window opens', () => {
  const schedule = loadSchedule();
  const sayram = schedule.items.find((i) => i.id === 'd7-sayram-ticket');
  assert.equal(remainingDays(sayram, '2026-10-01'), 5);
  assert.match(formatRemainingLabel(sayram, '2026-10-01'), /距截止.*剩 5 天/);
});

test('sortByRemainingDays orders ascending by remaining days', () => {
  const schedule = loadSchedule();
  const pending = schedule.items.filter((i) => !i.booked);
  const sorted = sortByRemainingDays(pending, '2026-09-12');
  const remainings = sorted.map((i) => remainingDays(i, '2026-09-12'));
  assert.deepEqual(remainings, [...remainings].sort((a, b) => a - b));
  assert.equal(sorted[0].id, 'd3-kalajun-ticket');
});

test('formatBookWindow shows days remaining', () => {
  const text = formatBookWindow({ bookByDate: '2026-10-06', bookFromDate: '2026-09-29' }, '2026-10-05');
  assert.match(text, /剩 1 天/);
});

test('buildDailyMarkdown includes pending section', () => {
  const schedule = loadSchedule();
  const trip = loadTripProfile(loadConfig());
  const items = mergeProfileHotels(schedule.items, trip);
  const digest = selectDailyDigest(items, '2026-10-05', schedule);
  const md = buildDailyMarkdown(schedule, '2026-10-05', digest);
  assert.match(md, /按剩余时间/);
  assert.match(md, /独库/);
});

test('loadState and saveState round-trip', () => {
  const tmp = path.join(ROOT, 'reports', '.booking-reminders-test-state.json');
  try {
    saveState({ 'daily:2026-10-05': { sentAt: '2026-10-05T07:00:00+08:00' } }, tmp);
    const state = loadState(tmp);
    assert.equal(state['daily:2026-10-05'].sentAt, '2026-10-05T07:00:00+08:00');
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
});

test('formatReserveTime shows appointment slot', () => {
  const schedule = loadSchedule();
  const duku = schedule.items.find((i) => i.id === 'd6-duku-reserve');
  assert.match(formatReserveTime(duku), /10\/6 14:00–16:00/);
});

test('no d6 sayram ticket in schedule after D6 no-entry change', () => {
  const schedule = loadSchedule();
  const ids = schedule.items.map((i) => i.id);
  assert.ok(!ids.includes('d6-sayram-ticket'));
  assert.ok(ids.includes('d7-sayram-ticket'));
});

test('isDigestItem excludes booked hotel and flight', () => {
  assert.equal(isDigestItem({ booked: true, category: 'hotel' }), false);
  assert.equal(isDigestItem({ booked: true, category: 'flight' }), false);
  assert.equal(isDigestItem({ booked: false, category: 'ticket' }), true);
});

test('selectDailyDigest dueToday skips booked items on event date', () => {
  const schedule = loadSchedule();
  const trip = loadTripProfile(loadConfig());
  const items = mergeProfileHotels(schedule.items, trip);
  const digest = selectDailyDigest(items, '2026-10-01', schedule);
  const dueIds = digest.dueToday.map((i) => i.id);
  assert.ok(!dueIds.includes('d1-flight-out'));
  assert.ok(!dueIds.includes('d1-hotel'));
});

test('itemsForRemindDate excludes booked hotel items', () => {
  const schedule = loadSchedule();
  const items = itemsForRemindDate(schedule, '2026-10-06');
  const ids = items.map((i) => i.id);
  assert.ok(!ids.includes('d7-hotel'));
  assert.ok(ids.includes('d7-sayram-ticket'));
});

test('selectDailyDigest tomorrowPrep only lists pending todos', () => {
  const schedule = loadSchedule();
  const trip = loadTripProfile(loadConfig());
  const items = mergeProfileHotels(schedule.items, trip);
  const digest = selectDailyDigest(items, '2026-09-30', schedule);
  const tomorrowIds = digest.tomorrowPrep.map((i) => i.id);
  assert.ok(!tomorrowIds.some((id) => id.includes('hotel') || id.includes('flight')));
});
