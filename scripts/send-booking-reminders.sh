#!/usr/bin/env bash
# Daily 07:00 booking digest → Feishu (pending items + booking deadlines).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=load-env.sh
source "$SCRIPT_DIR/load-env.sh"
# shellcheck source=feishu-env.sh
source "$SCRIPT_DIR/feishu-env.sh"

DRY_RUN=0
for arg in "$@"; do
  if [[ "$arg" == "--dry-run" ]]; then
    DRY_RUN=1
    break
  fi
done

if [[ "$DRY_RUN" -eq 0 ]] && ! feishu_notify_enabled; then
  echo "Feishu not configured; skip booking reminders (run: npm run setup:feishu)" >&2
  exit 0
fi

exec node "$SCRIPT_DIR/booking-reminders.js" "$@"
