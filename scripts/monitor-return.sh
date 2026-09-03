#!/usr/bin/env bash
# Skill: 返程 + 酒店 + 旅行计划（去程已订，不再查询去程）
# Usage: bash scripts/monitor-return.sh
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
BRIEF="$ROOT_DIR/reports/xinjiang-flights-brief.md"
PLAN="$ROOT_DIR/reports/xinjiang-travel-plan.md"

echo "▶ 返程 Skill：伊宁→广州 + 酒店 + 旅行计划（去程已订）" >&2
node "$SCRIPT_DIR/monitor-hotels.js" || echo "Hotel monitor skipped (non-fatal)" >&2
node "$SCRIPT_DIR/monitor-run.js" --phase return "$RESULTS" "$OUTPUT" "$RANKED"

if feishu_notify_enabled; then
  # 去程已订时强制推送完整简报（含行程+酒店），不再只推 ranked 航班
  if [[ -f "$ROOT_DIR/config/trip-profile.json" ]] && grep -q '"skipOutboundMonitor": true' "$ROOT_DIR/config/trip-profile.json" 2>/dev/null; then
    FEISHU_REPORT="${FEISHU_REPORT:-brief}"
    if [[ "$FEISHU_REPORT" == "ranked" ]]; then
      FEISHU_REPORT="brief"
      echo "去程已订 → 飞书改为推送决策简报（含行程+酒店）" >&2
    fi
  else
    FEISHU_REPORT="${FEISHU_REPORT:-brief}"
  fi
  echo "Sending Feishu ($FEISHU_REPORT)..." >&2
  eval "$(node "$SCRIPT_DIR/monitor-config.js" export-bash)"
  case "$FEISHU_REPORT" in
    ranked)
      node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 返程 TOP3" "$RANKED" || true
      ;;
    plan)
      [[ -f "$PLAN" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 旅行计划" "$PLAN" || true
      ;;
    all)
      [[ -f "$BRIEF" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 决策简报" "$BRIEF" || true
      [[ -f "$PLAN" ]] && node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 旅行计划" "$PLAN" || true
      node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 返程 TOP3" "$RANKED" || true
      ;;
    brief|*)
      if [[ -f "$BRIEF" ]]; then
        node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 决策简报" "$BRIEF" || true
      fi
      if [[ -f "$PLAN" ]]; then
        node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 旅行计划" "$PLAN" || true
      fi
      CARDS="$ROOT_DIR/reports/xinjiang-travel-cards.md"
      if [[ -f "$CARDS" ]]; then
        node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 8天行程卡片" "$CARDS" || true
      fi
      ;;
  esac
fi
