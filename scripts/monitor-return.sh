#!/usr/bin/env bash
# Skill phases 2→3→4（去程已订时）：返程航班 → 旅行计划 → 酒店
# Priority: 1 outbound | 2 return | 3 plan | 4 hotels — see scripts/trip-workflow.js
# Usage:
#   bash scripts/monitor-return.sh              # 2+3+4 按序执行
#   bash scripts/monitor-return.sh --flights-only # 仅 phase 2
#   bash scripts/monitor-return.sh --plan-only  # 仅 phase 3
#   bash scripts/monitor-return.sh --hotels-only # 仅 phase 4
set -euo pipefail

if [[ "${1:-}" == "--flights-only" ]]; then
  exec bash "$(dirname "$0")/monitor-return-flights.sh" "${@:2}"
fi
if [[ "${1:-}" == "--plan-only" ]]; then
  exec bash "$(dirname "$0")/monitor-travel-plan.sh" "${@:2}"
fi
if [[ "${1:-}" == "--hotels-only" ]]; then
  exec bash "$(dirname "$0")/monitor-hotels-phase.sh" "${@:2}"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"
source "$SCRIPT_DIR/load-env.sh"
# shellcheck source=feishu-env.sh
source "$SCRIPT_DIR/feishu-env.sh"

node "$SCRIPT_DIR/trip-workflow-cli.js" status >&2

RESULTS="$ROOT_DIR/reports/xinjiang-results.jsonl"
OUTPUT="$ROOT_DIR/reports/xinjiang-flights-latest.md"
RANKED="$ROOT_DIR/reports/xinjiang-flights-ranked.md"
FLIGHTS_BRIEF="$ROOT_DIR/reports/xinjiang-flights-brief.md"
TRAVEL_BRIEF="$ROOT_DIR/reports/xinjiang-travel-brief.md"
PLAN="$ROOT_DIR/reports/xinjiang-travel-plan.md"

echo "▶ Phase 2/4：返程航班" >&2
FEISHU_SKIP=1 bash "$SCRIPT_DIR/monitor-return-flights.sh" "${@}"

echo "▶ Phase 3/4：旅行计划 Plan A / Plan B" >&2
FEISHU_SKIP=1 bash "$SCRIPT_DIR/monitor-travel-plan.sh"

echo "▶ Phase 4/4：酒店" >&2
FEISHU_SKIP=1 bash "$SCRIPT_DIR/monitor-hotels-phase.sh"

# Full pipeline Feishu: push in priority order (return → plan → hotels)
if feishu_notify_enabled; then
  eval "$(node "$SCRIPT_DIR/monitor-config.js" export-bash)"
  FEISHU_REPORT="${FEISHU_REPORT:-all}"
  echo "Sending Feishu ($FEISHU_REPORT, priority order)..." >&2
  case "$FEISHU_REPORT" in
    ranked)
      node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 返程 TOP3" "$RANKED" || true
      ;;
    plan)
      [[ -f "$PLAN" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 旅行计划" "$PLAN" || true
      ;;
    brief)
      [[ -f "$TRAVEL_BRIEF" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 行程·酒店简报" "$TRAVEL_BRIEF" || true
      ;;
    all|*)
      node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 返程 TOP3" "$RANKED" || true
      [[ -f "$FLIGHTS_BRIEF" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 返程机票简报" "$FLIGHTS_BRIEF" || true
      CARDS="$ROOT_DIR/reports/xinjiang-travel-cards.md"
      CARDS_PLANB="$ROOT_DIR/reports/xinjiang-travel-cards-planb.md"
      [[ -f "$CARDS" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 8天行程（独库）" "$CARDS" || true
      [[ -f "$CARDS_PLANB" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 8天行程（Plan B 备选）" "$CARDS_PLANB" || true
      [[ -f "$TRAVEL_BRIEF" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 行程·酒店简报" "$TRAVEL_BRIEF" || true
      ;;
  esac
fi

