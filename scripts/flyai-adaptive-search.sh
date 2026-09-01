#!/usr/bin/env bash
# Adaptive time-slice flight search per FlyAI skill spec
set -euo pipefail

FLYAI="${FLYAI:-npx flyai}"
DEDUP="${DEDUP:-$(dirname "$0")/flyai-dedup.js}"

origin="$1"
destination="$2"
dep_date="$3"
journey_type="${4:-1}"

TMPFILE=$(mktemp /tmp/flyai-XXXX.json)
API_COUNT=0

query_window() {
  local start=$1 end=$2
  sleep 1
  $FLYAI search-flight \
    --origin "$origin" \
    --destination "$destination" \
    --dep-date "$dep_date" \
    --journey-type "$journey_type" \
    --dep-hour-start "$start" \
    --dep-hour-end "$end" \
    2>/dev/null >> "$TMPFILE" || true
  API_COUNT=$((API_COUNT + 1))
}

count_last() {
  node -e "
    const fs=require('fs');
    const lines=fs.readFileSync('$TMPFILE','utf8').trim().split('\n').filter(Boolean);
    if(!lines.length){console.log(0);process.exit(0);}
    const j=JSON.parse(lines[lines.length-1]);
    console.log((j.data&&j.data.itemList||[]).length);
  "
}

slice_recursive() {
  local start=$1 end=$2 min_hours=${3:-1}
  query_window "$start" "$end"
  local cnt
  cnt=$(count_last)
  local span=$((end - start))
  if [[ "$cnt" -lt 10 ]] || [[ "$span" -le "$min_hours" ]]; then
    return
  fi
  local mid=$(( (start + end) / 2 ))
  slice_recursive "$start" "$mid" "$min_hours"
  slice_recursive "$mid" "$end" "$min_hours"
}

slice_recursive 0 24 1

RESULT=$(cat "$TMPFILE" | node "$DEDUP" 2>&1)
DEDUP_MSG=$(echo "$RESULT" | head -1)
FLIGHTS=$(echo "$RESULT" | tail -n +2)

echo "{\"route\":\"$origin→$destination\",\"date\":\"$dep_date\",\"apiCount\":$API_COUNT,\"dedup\":\"$DEDUP_MSG\",\"flights\":$FLIGHTS}" 

rm -f "$TMPFILE"
