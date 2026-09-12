#!/usr/bin/env bash
# Daily booking reminders → Feishu (1 day before each event date).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=load-env.sh
source "$SCRIPT_DIR/load-env.sh"
# shellcheck source=feishu-env.sh
source "$SCRIPT_DIR/feishu-env.sh"

if ! feishu_notify_enabled; then
  echo "Feishu not configured; skip booking reminders (run: npm run setup:feishu)" >&2
  exit 0
fi

exec node "$SCRIPT_DIR/booking-reminders.js" "$@"
