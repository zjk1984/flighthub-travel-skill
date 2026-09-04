#!/usr/bin/env bash
# Phase 4: 酒店查询 + 行程·酒店简报（需 Plan 已确认）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"
source "$SCRIPT_DIR/load-env.sh"
# shellcheck source=feishu-env.sh
source "$SCRIPT_DIR/feishu-env.sh"

RESULTS="$ROOT_DIR/reports/xinjiang-results.jsonl"
TRAVEL_BRIEF="$ROOT_DIR/reports/xinjiang-travel-brief.md"

echo "▶ Phase 4/4：酒店（按 activeVariant 酒店段）" >&2
node "$SCRIPT_DIR/trip-workflow-cli.js" gate hotels >&2 || true
node "$SCRIPT_DIR/monitor-hotels.js" || echo "Hotel monitor skipped (non-fatal)" >&2
node "$SCRIPT_DIR/format-travel-brief.js" "$RESULTS" > "$TRAVEL_BRIEF"

if feishu_notify_enabled && [[ "${FEISHU_SKIP:-}" != "1" ]]; then
  eval "$(node "$SCRIPT_DIR/monitor-config.js" export-bash)"
  FEISHU_REPORT="${FEISHU_REPORT:-brief}"
  case "$FEISHU_REPORT" in
    ranked)
      RANKED="$ROOT_DIR/reports/xinjiang-hotels-latest-ranked.md"
      [[ -f "$RANKED" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 酒店 TOP3" "$RANKED" || true
      ;;
    all)
      RANKED="$ROOT_DIR/reports/xinjiang-hotels-latest-ranked.md"
      [[ -f "$RANKED" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 酒店 TOP3" "$RANKED" || true
      [[ -f "$TRAVEL_BRIEF" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 行程·酒店简报" "$TRAVEL_BRIEF" || true
      ;;
    brief|*)
      [[ -f "$TRAVEL_BRIEF" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 行程·酒店简报" "$TRAVEL_BRIEF" || true
      ;;
  esac
fi
