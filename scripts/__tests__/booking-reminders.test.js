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
  sortByReserveTime,
  buildDailyMarkdown,
  loadState,
  saveState,
  addDays,
  formatBookWindow,
  formatReserveTime,
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

test('formatBookWindow shows days remaining', () => {
  const text = formatBookWindow({ bookByDate: '2026-10-06' }, '2026-10-05');
  assert.match(text, /剩 1 天/);
});

test('buildDailyMarkdown includes pending section', () => {
  const schedule = loadSchedule();
  const trip = loadTripProfile(loadConfig());
  const items = mergeProfileHotels(schedule.items, trip);
  const digest = selectDailyDigest(items, '2026-10-05', schedule);
  const md = buildDailyMarkdown(schedule, '2026-10-05', digest);
  assert.match(md, /每日 digest/);
  assert.match(md, /待办/);
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

test('sortByReserveTime orders pending by bookByDate then bookTime', () => {
  const schedule = loadSchedule();
  const pending = schedule.items.filter((i) => !i.booked);
  const sorted = [...pending].sort(sortByReserveTime);
  const ids = sorted.map((i) => i.id);
  const yuhuIdx = ids.indexOf('d2-yuhu-ticket');
  const kalajunIdx = ids.indexOf('d3-kalajun-ticket');
  const dukuIdx = ids.indexOf('d6-duku-reserve');
  const sayramIdx = ids.indexOf('d7-sayram-ticket');
  assert.ok(yuhuIdx < kalajunIdx);
  assert.ok(kalajunIdx < dukuIdx);
  assert.ok(dukuIdx < sayramIdx);
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
