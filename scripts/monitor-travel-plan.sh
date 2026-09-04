#!/usr/bin/env bash
# Phase 3: 旅行计划 Plan A / Plan B（不查机票、不查酒店 API）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"
source "$SCRIPT_DIR/load-env.sh"
# shellcheck source=feishu-env.sh
source "$SCRIPT_DIR/feishu-env.sh"

RESULTS="$ROOT_DIR/reports/xinjiang-results.jsonl"

echo "▶ Phase 3/4：旅行计划（Plan A / Plan B 卡片 + 计划 + 行程简报）" >&2
node "$SCRIPT_DIR/trip-workflow-cli.js" gate plan >&2 || true
node "$SCRIPT_DIR/monitor-run.js" --phase return --plan-only "$RESULTS"

if feishu_notify_enabled && [[ "${FEISHU_SKIP:-}" != "1" ]]; then
  eval "$(node "$SCRIPT_DIR/monitor-config.js" export-bash)"
  FEISHU_REPORT="${FEISHU_REPORT:-plan}"
  case "$FEISHU_REPORT" in
    all)
      CARDS="$ROOT_DIR/reports/xinjiang-travel-cards.md"
      CARDS_B="$ROOT_DIR/reports/xinjiang-travel-cards-planb.md"
      PLAN="$ROOT_DIR/reports/xinjiang-travel-plan.md"
      BRIEF="$ROOT_DIR/reports/xinjiang-travel-brief.md"
      [[ -f "$CARDS" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 8天行程（独库）" "$CARDS" || true
      [[ -f "$CARDS_B" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 8天行程（Plan B）" "$CARDS_B" || true
      [[ -f "$PLAN" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 旅行计划" "$PLAN" || true
      [[ -f "$BRIEF" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 行程简报" "$BRIEF" || true
      ;;
    plan|*)
      CARDS="$ROOT_DIR/reports/xinjiang-travel-cards.md"
      CARDS_B="$ROOT_DIR/reports/xinjiang-travel-cards-planb.md"
      [[ -f "$CARDS" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 8天行程（独库）" "$CARDS" || true
      [[ -f "$CARDS_B" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 8天行程（Plan B 备选）" "$CARDS_B" || true
      ;;
  esac
fi
