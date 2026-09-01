#!/usr/bin/env bash
# Monitor low-price flights: Guangdong ↔ Xinjiang (multi-airport)
# Usage: bash scripts/monitor-xinjiang.sh [output.md]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export FLYAI="${FLYAI:-npx flyai}"
export DEDUP="$SCRIPT_DIR/flyai-dedup.js"
cd "$ROOT_DIR"

eval "$(node "$SCRIPT_DIR/monitor-config.js" export-bash)"
echo "Monitor config: $ROUTE_LABEL | 出发 ${ORIGINS[*]} → ${DESTINATIONS[*]}" >&2
echo "  去程: ${OUTBOUND_DATES[*]} | 返程: ${RETURN_DATES[*]}" >&2

OUTPUT="${1:-$ROOT_DIR/reports/xinjiang-flights-latest.md}"
RANKED_OUTPUT="${2:-$ROOT_DIR/reports/xinjiang-flights-ranked.md}"
TMP_RESULTS=$(mktemp /tmp/xinjiang-results-XXXX.jsonl)

flight_count() {
  node -e "
    const fs=require('fs');
    const raw=fs.readFileSync(process.argv[1],'utf8');
    const parts=[]; let d=0,s=0;
    for(let i=0;i<raw.length;i++){
      if(raw[i]==='{'){if(d===0)s=i;d++;}
      else if(raw[i]==='}'){d--;if(d===0)parts.push(raw.slice(s,i+1));}
    }
    if(!parts.length){console.log(0);process.exit(0);}
    const j=JSON.parse(parts[parts.length-1]);
    console.log((j.flights||[]).length);
  " "$TMP_RESULTS"
}

run_search() {
  local origin=$1 dest=$2 date=$3 jt=$4
  echo "Searching: $origin → $dest | $date | jt=$jt ..." >&2
  "$SCRIPT_DIR/flyai-adaptive-search.sh" "$origin" "$dest" "$date" "$jt" >> "$TMP_RESULTS"
}

run_search_smart() {
  local origin=$1 dest=$2 date=$3
  run_search "$origin" "$dest" "$date" 1
  local count
  count=$(flight_count)
  if [[ "$count" -eq 0 ]]; then
    run_search "$origin" "$dest" "$date" 2
  fi
}

# Outbound: 出发地 → 目的地
for date in "${OUTBOUND_DATES[@]}"; do
  for origin in "${ORIGINS[@]}"; do
    for dest in "${DESTINATIONS[@]}"; do
      if [[ " ${DIRECT_ONLY_AIRPORTS[*]} " == *" $dest "* ]]; then
        run_search "$origin" "$dest" "$date" 1
      else
        run_search_smart "$origin" "$dest" "$date"
      fi
    done
  done
done

# Return: 目的地 → 出发地
for date in "${RETURN_DATES[@]}"; do
  for dest in "${DESTINATIONS[@]}"; do
    for origin in "${ORIGINS[@]}"; do
      if [[ " ${DIRECT_ONLY_AIRPORTS[*]} " == *" $dest "* ]]; then
        run_search "$dest" "$origin" "$date" 1
      else
        run_search_smart "$dest" "$origin" "$date"
      fi
    done
  done
done

mkdir -p "$(dirname "$OUTPUT")"
node "$SCRIPT_DIR/format-xinjiang-report.js" < "$TMP_RESULTS" > "$OUTPUT"
node "$SCRIPT_DIR/format-ranked-report.js" < "$TMP_RESULTS" > "$RANKED_OUTPUT"
cp "$TMP_RESULTS" "$ROOT_DIR/reports/xinjiang-results.jsonl"
echo "Report saved to: $OUTPUT" >&2
echo "Ranked report saved to: $RANKED_OUTPUT" >&2

# Feishu card notification (optional)
if [[ -n "${FEISHU_WEBHOOK_URL:-}" ]]; then
  FEISHU_REPORT="${FEISHU_REPORT:-ranked}"
  echo "Sending Feishu notification ($FEISHU_REPORT)..." >&2
  send_feishu() {
    node "$SCRIPT_DIR/feishu-notify.js" --title "$1" "$2" || echo "Feishu notification failed (non-fatal)" >&2
  }
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

rm -f "$TMP_RESULTS"
