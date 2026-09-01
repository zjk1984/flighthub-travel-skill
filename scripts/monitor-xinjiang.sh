#!/usr/bin/env bash
# Monitor low-price flights: Guangdong ↔ Xinjiang
# Usage: bash scripts/monitor-xinjiang.sh [output.md]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export FLYAI="${FLYAI:-npx flyai}"
export DEDUP="$SCRIPT_DIR/flyai-dedup.js"
cd "$ROOT_DIR"

OUTBOUND_DATES=(2026-09-28 2026-09-29 2026-09-30 2026-10-01)
RETURN_DATES=(2026-10-06 2026-10-07 2026-10-08)
ORIGINS=(深圳 广州)
DEST=乌鲁木齐

OUTPUT="${1:-$ROOT_DIR/reports/xinjiang-flights-latest.md}"
TMP_RESULTS=$(mktemp /tmp/xinjiang-results-XXXX.jsonl)

run_search() {
  local origin=$1 dest=$2 date=$3
  echo "Searching: $origin → $dest | $date ..." >&2
  "$SCRIPT_DIR/flyai-adaptive-search.sh" "$origin" "$dest" "$date" 1 >> "$TMP_RESULTS"
}

# Outbound: 深圳/广州 → 乌鲁木齐
for date in "${OUTBOUND_DATES[@]}"; do
  for origin in "${ORIGINS[@]}"; do
    run_search "$origin" "$DEST" "$date"
  done
done

# Return: 乌鲁木齐 → 深圳/广州
for date in "${RETURN_DATES[@]}"; do
  for dest in "${ORIGINS[@]}"; do
    run_search "$DEST" "$dest" "$date"
  done
done

mkdir -p "$(dirname "$OUTPUT")"
node "$SCRIPT_DIR/format-xinjiang-report.js" < "$TMP_RESULTS" > "$OUTPUT"
echo "Report saved to: $OUTPUT" >&2
rm -f "$TMP_RESULTS"
