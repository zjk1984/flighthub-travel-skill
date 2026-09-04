#!/usr/bin/env bash
# Run trip skill phases in priority order: outbound → return → plan → hotels
# Usage:
#   bash scripts/run-trip-workflow.sh           # from current phase → hotels
#   bash scripts/run-trip-workflow.sh --status
#   bash scripts/run-trip-workflow.sh --phase return
#   bash scripts/run-trip-workflow.sh --refresh # pass --refresh to return flights
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

PHASE=""
STATUS_ONLY=false
REFRESH=""
ARGS=("$@")
i=0
while [[ $i -lt ${#ARGS[@]} ]]; do
  arg="${ARGS[$i]}"
  case "$arg" in
    --status) STATUS_ONLY=true ;;
    --refresh) REFRESH="--refresh" ;;
    --phase)
      i=$((i + 1))
      PHASE="${ARGS[$i]:-}"
      ;;
  esac
  i=$((i + 1))
done

node "$SCRIPT_DIR/trip-workflow-cli.js" status
if [[ "$STATUS_ONLY" == "true" ]]; then exit 0; fi

CURRENT="$(node "$SCRIPT_DIR/trip-workflow-cli.js" current)"
START="${PHASE:-$CURRENT}"

run_phase() {
  case "$1" in
    outbound) bash "$SCRIPT_DIR/monitor-outbound.sh" ;;
    return)   bash "$SCRIPT_DIR/monitor-return-flights.sh" $REFRESH ;;
    plan)     bash "$SCRIPT_DIR/monitor-travel-plan.sh" ;;
    hotels)   bash "$SCRIPT_DIR/monitor-hotels-phase.sh" ;;
    done)
      echo "▶ 全部阶段已确认，可按需单独 refresh。" >&2
      return 0
      ;;
    *)
      echo "Unknown phase: $1" >&2
      exit 1
      ;;
  esac
}

ORDER=(outbound return plan hotels)
STARTED=false
for p in "${ORDER[@]}"; do
  if [[ "$p" == "$START" ]]; then STARTED=true; fi
  if [[ "$STARTED" == "true" ]]; then
    run_phase "$p"
  fi
done
