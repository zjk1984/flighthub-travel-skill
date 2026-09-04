#!/usr/bin/env bash
# Skill: 返程 + 酒店 + 旅行计划（去程已订，不再查询去程）
# Usage:
#   bash scripts/monitor-return.sh              # 完整：酒店 + 航班 + 行程
#   bash scripts/monitor-return.sh --flights-only  # 仅返程航班（见 monitor-return-flights.sh）
set -euo pipefail

if [[ "${1:-}" == "--flights-only" ]]; then
  exec bash "$(dirname "$0")/monitor-return-flights.sh" "${@:2}"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"
source "$SCRIPT_DIR/load-env.sh"
# shellcheck source=feishu-env.sh
source "$SCRIPT_DIR/feishu-env.sh"

RESULTS="$ROOT_DIR/reports/xinjiang-results.jsonl"
OUTPUT="$ROOT_DIR/reports/xinjiang-flights-latest.md"
RANKED="$ROOT_DIR/reports/xinjiang-flights-ranked.md"
FLIGHTS_BRIEF="$ROOT_DIR/reports/xinjiang-flights-brief.md"
TRAVEL_BRIEF="$ROOT_DIR/reports/xinjiang-travel-brief.md"
PLAN="$ROOT_DIR/reports/xinjiang-travel-plan.md"

echo "▶ 返程 Skill：伊宁→广州 + 酒店 + 旅行计划（去程已订）" >&2
node "$SCRIPT_DIR/monitor-hotels.js" || echo "Hotel monitor skipped (non-fatal)" >&2
node "$SCRIPT_DIR/monitor-run.js" --phase return "$RESULTS" "$OUTPUT" "$RANKED"

if feishu_notify_enabled; then
  eval "$(node "$SCRIPT_DIR/monitor-config.js" export-bash)"
  # 去程已订：默认飞书推 ranked TOP3；完整行程/酒店用 FEISHU_REPORT=brief|all
  if [[ -f "$ROOT_DIR/config/trip-profile.json" ]] && grep -q '"skipOutboundMonitor": true' "$ROOT_DIR/config/trip-profile.json" 2>/dev/null; then
    FEISHU_REPORT="${FEISHU_REPORT:-ranked}"
  else
    FEISHU_REPORT="${FEISHU_REPORT:-brief}"
  fi
  echo "Sending Feishu ($FEISHU_REPORT)..." >&2
  case "$FEISHU_REPORT" in
    ranked)
      node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 返程 TOP3" "$RANKED" || true
      ;;
    plan)
      [[ -f "$PLAN" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 旅行计划" "$PLAN" || true
      ;;
    all)
      [[ -f "$FLIGHTS_BRIEF" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 返程机票简报" "$FLIGHTS_BRIEF" || true
      [[ -f "$TRAVEL_BRIEF" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 行程·酒店简报" "$TRAVEL_BRIEF" || true
      [[ -f "$PLAN" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 旅行计划" "$PLAN" || true
      node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 返程 TOP3" "$RANKED" || true
      ;;
    brief|*)
      [[ -f "$TRAVEL_BRIEF" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 行程·酒店简报" "$TRAVEL_BRIEF" || true
      if [[ -f "$PLAN" ]]; then
        node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 旅行计划" "$PLAN" || true
      fi
      CARDS="$ROOT_DIR/reports/xinjiang-travel-cards.md"
      if [[ -f "$CARDS" ]]; then
        node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 8天行程（独库）" "$CARDS" || true
      fi
      CARDS_PLANB="$ROOT_DIR/reports/xinjiang-travel-cards-planb.md"
      if [[ -f "$CARDS_PLANB" ]]; then
        node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 8天行程（Plan B 备选）" "$CARDS_PLANB" || true
      fi
      ;;
  esac
fi
