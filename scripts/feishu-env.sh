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
