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
  buildMarkdown,
  loadState,
  saveState,
} = require('../booking-reminders.js');

const ROOT = path.join(__dirname, '..', '..');
const SCHEDULE_PATH = path.join(ROOT, 'config', 'booking-schedule.json');

test('itemsForRemindDate picks items one day before event', () => {
  const schedule = loadSchedule();
  const items = itemsForRemindDate(schedule, '2026-10-05');
  assert.ok(items.length >= 3);
  assert.equal(items[0].eventDate, '2026-10-06');
  assert.equal(items[items.length - 1].eventDate, '2026-10-06');
});

test('itemsForRemindDate sorts by eventDate then sortOrder', () => {
  const schedule = loadSchedule();
  const items = itemsForRemindDate(schedule, '2026-09-30');
  assert.equal(items[0].eventDate, '2026-10-01');
  assert.equal(items[0].sortOrder, 10);
  const orders = items.map((i) => i.sortOrder);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
});

test('mergeProfileHotels marks booked hotels from trip profile', () => {
  const schedule = loadSchedule();
  const trip = loadTripProfile(loadConfig());
  const merged = mergeProfileHotels(schedule.items, trip);
  const d6Hotel = merged.find((i) => i.id === 'd6-hotel');
  assert.equal(d6Hotel.booked, true);
  assert.match(d6Hotel.title, /喀兰朵/);
});

test('buildMarkdown includes chronological list', () => {
  const schedule = loadSchedule();
  const items = itemsForRemindDate(schedule, '2026-10-05');
  const md = buildMarkdown(schedule, '2026-10-05', items);
  assert.match(md, /行程预订提醒|伊犁8天自驾/);
  assert.match(md, /10\/6/);
  assert.match(md, /喀兰朵/);
  assert.match(md, /独库/);
});

test('loadState and saveState round-trip', () => {
  const tmp = path.join(ROOT, 'reports', '.booking-reminders-test-state.json');
  try {
    saveState({ '2026-10-05:2026-10-06': { sentAt: '2026-10-05T09:00:00Z' } }, tmp);
    const state = loadState(tmp);
    assert.equal(state['2026-10-05:2026-10-06'].sentAt, '2026-10-05T09:00:00Z');
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
});
