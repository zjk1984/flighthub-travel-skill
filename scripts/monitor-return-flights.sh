#!/usr/bin/env bash
# 仅查询返程航班（跳过酒店、行程卡片、旅行计划）
# Usage: bash scripts/monitor-return-flights.sh [--refresh]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"
source "$SCRIPT_DIR/load-env.sh"
# shellcheck source=feishu-env.sh
source "$SCRIPT_DIR/feishu-env.sh"

RESULTS="$ROOT_DIR/reports/xinjiang-results.jsonl"
OUTPUT="$ROOT_DIR/reports/xinjiang-flights-latest.md"
RANKED="$ROOT_DIR/reports/xinjiang-flights-ranked.md"

REFRESH=false
for arg in "$@"; do
  if [[ "$arg" == "--refresh" ]]; then REFRESH=true; fi
done

EXTRA_ARGS=()
if [[ "$REFRESH" == "true" ]]; then
  EXTRA_ARGS+=(--refresh)
fi

if feishu_todos_only; then
  echo "▶ 返程已订 — 跳过 fly.ai 机票查询" >&2
else
  echo "▶ 返程航班（仅机票，不含酒店/行程）" >&2
  node "$SCRIPT_DIR/monitor-run.js" --phase return --flights-only "${EXTRA_ARGS[@]}" "$RESULTS" "$OUTPUT" "$RANKED"
fi

if feishu_notify_enabled && [[ "${FEISHU_SKIP:-}" != "1" ]]; then
  if feishu_todos_only; then
    echo "Sending Feishu (机酒已订 — 仅待办 digest)..." >&2
    node "$SCRIPT_DIR/booking-reminders.js" --force || true
  else
  eval "$(node "$SCRIPT_DIR/monitor-config.js" export-bash)"
  FLIGHTS_BRIEF="$ROOT_DIR/reports/xinjiang-flights-brief.md"
  FEISHU_REPORT="${FEISHU_REPORT:-all}"
  echo "Sending Feishu (return flights: $FEISHU_REPORT)..." >&2
  case "$FEISHU_REPORT" in
    ranked)
      node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 返程 TOP3" "$RANKED" || true
      ;;
    brief)
      [[ -f "$FLIGHTS_BRIEF" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 返程机票简报" "$FLIGHTS_BRIEF" || true
      ;;
    all|*)
      node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 返程 TOP3" "$RANKED" || true
      [[ -f "$FLIGHTS_BRIEF" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 返程机票简报" "$FLIGHTS_BRIEF" || true
      ;;
  esac
  fi
fi
