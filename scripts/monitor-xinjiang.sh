#!/usr/bin/env bash
# Monitor low-price flights: Guangdong ↔ Xinjiang (multi-airport)
# Usage: bash scripts/monitor-xinjiang.sh [output.md]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export FLYAI="${FLYAI:-npx flyai}"
export DEDUP="$SCRIPT_DIR/flyai-dedup.js"
cd "$ROOT_DIR"

OUTBOUND_DATES=(2026-09-28 2026-09-29 2026-09-30 2026-10-01)
RETURN_DATES=(2026-10-06 2026-10-07 2026-10-08)
GUANGDONG=(深圳 广州)
# API 城市名：伊犁用「伊宁」
XINJIANG=(乌鲁木齐 伊宁 阿勒泰 石河子)

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

# Outbound: 深圳/广州 → 新疆各机场
for date in "${OUTBOUND_DATES[@]}"; do
  for origin in "${GUANGDONG[@]}"; do
    for xj in "${XINJIANG[@]}"; do
      if [[ "$xj" == "乌鲁木齐" ]]; then
        run_search "$origin" "$xj" "$date" 1
      else
        run_search_smart "$origin" "$xj" "$date"
      fi
    done
  done
done

# Return: 新疆各机场 → 深圳/广州
for date in "${RETURN_DATES[@]}"; do
  for xj in "${XINJIANG[@]}"; do
    for dest in "${GUANGDONG[@]}"; do
      if [[ "$xj" == "乌鲁木齐" ]]; then
        run_search "$xj" "$dest" "$date" 1
      else
        run_search_smart "$xj" "$dest" "$date"
      fi
    done
  done
done

mkdir -p "$(dirname "$OUTPUT")"
node "$SCRIPT_DIR/format-xinjiang-report.js" < "$TMP_RESULTS" > "$OUTPUT"
node "$SCRIPT_DIR/format-ranked-report.js" < "$TMP_RESULTS" > "$RANKED_OUTPUT"
echo "Report saved to: $OUTPUT" >&2
echo "Ranked report saved to: $RANKED_OUTPUT" >&2
rm -f "$TMP_RESULTS"
