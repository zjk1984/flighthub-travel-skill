#!/usr/bin/env bash
# Monitor low-price flights: Guangdong ↔ Xinjiang (unified orchestrator)
# Usage: bash scripts/monitor-xinjiang.sh [latest.md] [ranked.md]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"
# shellcheck source=load-env.sh
source "$SCRIPT_DIR/load-env.sh"

OUTPUT="${1:-$ROOT_DIR/reports/xinjiang-flights-latest.md}"
RANKED_OUTPUT="${2:-$ROOT_DIR/reports/xinjiang-flights-ranked.md}"
RESULTS="$ROOT_DIR/reports/xinjiang-results.jsonl"

node "$SCRIPT_DIR/monitor-run.js" "$RESULTS" "$OUTPUT" "$RANKED_OUTPUT"

# Feishu card notification (optional)
if [[ -n "${FEISHU_WEBHOOK_URL:-}" ]]; then
  FEISHU_REPORT="${FEISHU_REPORT:-ranked}"
  echo "Sending Feishu notification ($FEISHU_REPORT)..." >&2
  send_feishu() {
    node "$SCRIPT_DIR/feishu-notify.js" --title "$1" "$2" || echo "Feishu notification failed (non-fatal)" >&2
  }
  eval "$(node "$SCRIPT_DIR/monitor-config.js" export-bash)"
  case "$FEISHU_REPORT" in
    latest)
      send_feishu "${ROUTE_LABEL} 低价机票监控报告" "$OUTPUT"
      ;;
    both)
      send_feishu "${ROUTE_LABEL} 每日 TOP3 航班推荐" "$RANKED_OUTPUT"
      send_feishu "${ROUTE_LABEL} 低价机票监控报告" "$OUTPUT"
      ;;
    *)
      send_feishu "${ROUTE_LABEL} 每日 TOP3 航班推荐" "$RANKED_OUTPUT"
      ;;
  esac
fi
