#!/usr/bin/env bash
# Shared Feishu notification gate (webhook or Open API app bot).
feishu_notify_enabled() {
  if [[ -n "${FEISHU_WEBHOOK_URL:-}" ]]; then
    return 0
  fi
  if [[ -n "${FEISHU_APP_ID:-}" && -n "${FEISHU_APP_SECRET:-}" && -n "${FEISHU_CHAT_ID:-}" ]]; then
    return 0
  fi
  return 1
}

# Exit 0 when flights + hotels are booked — Feishu should only push booking-schedule todos.
feishu_todos_only() {
  node -e "
    const { loadConfig } = require('./scripts/load-monitor-config');
    const { loadTripProfile, feishuTodosOnly } = require('./scripts/load-trip-profile');
    process.exit(feishuTodosOnly(loadTripProfile(loadConfig())) ? 0 : 1);
  " 2>/dev/null
}
