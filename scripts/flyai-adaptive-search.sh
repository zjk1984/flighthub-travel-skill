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
API_ERROR=""

extract_api_error() {
  local text="$1"
  if echo "$text" | grep -qE 'HTTP 451|risk control'; then
    echo "451:risk_control"
  elif echo "$text" | grep -qE 'HTTP 429|Trial limit'; then
    echo "429:trial_limit"
  elif echo "$text" | grep -qE 'HTTP [0-9]+'; then
    echo "$text" | grep -oE 'HTTP [0-9]+' | head -1 | tr ' ' ':'
  fi
}

append_json_lines() {
  local text="$1"
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    if echo "$line" | grep -qE '^\s*\{'; then
      echo "$line" >> "$TMPFILE"
    fi
  done <<< "$text"
}

query_window() {
  local start=$1 end=$2
  local sort_type="${3:-}"
  sleep 1
  local extra=()
  if [[ -n "$sort_type" ]]; then
    extra=(--sort-type "$sort_type")
  fi

  local out
  out=$($FLYAI search-flight \
    --origin "$origin" \
    --destination "$destination" \
    --dep-date "$dep_date" \
    --journey-type "$journey_type" \
    --dep-hour-start "$start" \
    --dep-hour-end "$end" \
    "${extra[@]}" 2>&1) || true
  API_COUNT=$((API_COUNT + 1))

  local err
  err=$(extract_api_error "$out")
  if [[ -n "$err" ]]; then
    [[ -z "$API_ERROR" ]] && API_ERROR="$err"
    echo "flyai-adaptive-search: ${origin}→${destination} ${dep_date} apiError=${err}" >&2
    return
  fi

  append_json_lines "$out"
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
  [[ -n "$API_ERROR" ]] && return
  local start=$1 end=$2 min_hours=${3:-1}
  query_window "$start" "$end"
  [[ -n "$API_ERROR" ]] && return
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

if [[ "$journey_type" == "2" ]]; then
  query_window 0 24 3
else
  slice_recursive 0 24 1
fi

RESULT=$(cat "$TMPFILE" | node "$DEDUP" 2>&1)
DEDUP_MSG=$(echo "$RESULT" | head -1)
FLIGHTS=$(echo "$RESULT" | tail -n +2)

export ROUTE="${origin}→${destination}"
export DEP_DATE="$dep_date"
export API_COUNT="$API_COUNT"
export DEDUP_MSG="$DEDUP_MSG"
export FLIGHTS_JSON="$FLIGHTS"
export API_ERROR
node <<'NODE'
const r = {
  route: process.env.ROUTE,
  date: process.env.DEP_DATE,
  apiCount: parseInt(process.env.API_COUNT, 10) || 0,
  dedup: process.env.DEDUP_MSG || "",
  flights: JSON.parse(process.env.FLIGHTS_JSON || "[]"),
};
if (process.env.API_ERROR) r.apiError = process.env.API_ERROR;
console.log(JSON.stringify(r));
NODE

rm -f "$TMPFILE"
