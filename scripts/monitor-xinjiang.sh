#!/usr/bin/env bash
# Monitor low-price flights: Guangdong ↔ Xinjiang (unified orchestrator)
# Usage:
#   bash scripts/monitor-xinjiang.sh [latest.md] [ranked.md]
#   bash scripts/monitor-xinjiang.sh --phase outbound|return|all [latest.md] [ranked.md]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"
# shellcheck source=load-env.sh
source "$SCRIPT_DIR/load-env.sh"
# shellcheck source=feishu-env.sh
source "$SCRIPT_DIR/feishu-env.sh"

PHASE="all"
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --phase)
      PHASE="${2:-all}"
      shift 2
      ;;
    --phase=*)
      PHASE="${1#*=}"
      shift
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done

OUTPUT="${POSITIONAL[0]:-$ROOT_DIR/reports/xinjiang-flights-latest.md}"
RANKED_OUTPUT="${POSITIONAL[1]:-$ROOT_DIR/reports/xinjiang-flights-ranked.md}"
RESULTS="$ROOT_DIR/reports/xinjiang-results.jsonl"

node "$SCRIPT_DIR/monitor-run.js" --phase "$PHASE" "$RESULTS" "$OUTPUT" "$RANKED_OUTPUT"

if feishu_notify_enabled && [[ "$PHASE" == "all" || "$PHASE" == "return" ]]; then
  FEISHU_REPORT="${FEISHU_REPORT:-brief}"
  echo "Sending Feishu notification ($FEISHU_REPORT)..." >&2
  BRIEF="$ROOT_DIR/reports/xinjiang-flights-brief.md"
  send_feishu() {
    node "$SCRIPT_DIR/feishu-notify.js" --title "$1" "$2" || echo "Feishu notification failed (non-fatal)" >&2
  }
  eval "$(node "$SCRIPT_DIR/monitor-config.js" export-bash)"
  case "$FEISHU_REPORT" in
    latest)
      send_feishu "${ROUTE_LABEL} 低价机票监控报告" "$OUTPUT"
      ;;
    ranked)
      send_feishu "${ROUTE_LABEL} 每日 TOP3 航班推荐" "$RANKED_OUTPUT"
      ;;
    both)
      send_feishu "${ROUTE_LABEL} 每日 TOP3 航班推荐" "$RANKED_OUTPUT"
      send_feishu "${ROUTE_LABEL} 低价机票监控报告" "$OUTPUT"
      ;;
    all)
      [[ -f "$BRIEF" ]] && send_feishu "${ROUTE_LABEL} 旅行决策简报" "$BRIEF"
      send_feishu "${ROUTE_LABEL} 每日 TOP3 航班推荐" "$RANKED_OUTPUT"
      ;;
    brief|*)
      if [[ -f "$BRIEF" ]]; then
        send_feishu "${ROUTE_LABEL} 旅行决策简报" "$BRIEF"
      else
        send_feishu "${ROUTE_LABEL} 每日 TOP3 航班推荐" "$RANKED_OUTPUT"
      fi
      ;;
  esac
fi
