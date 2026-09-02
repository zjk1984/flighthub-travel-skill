#!/usr/bin/env bash
# Skill: 广东 → 新疆 去程监控（独立运行，降低 API 风控）
# Usage: bash scripts/monitor-outbound.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"
source "$SCRIPT_DIR/load-env.sh"

RESULTS="$ROOT_DIR/reports/xinjiang-results.jsonl"
OUTPUT="$ROOT_DIR/reports/xinjiang-outbound-latest.md"
RANKED="$ROOT_DIR/reports/xinjiang-outbound-ranked.md"

echo "▶ 去程 Skill：广东 → 新疆（仅主查询，不含自定义中转）" >&2
node "$SCRIPT_DIR/monitor-run.js" --phase outbound "$RESULTS" "$OUTPUT" "$RANKED"

if [[ -n "${FEISHU_WEBHOOK_URL:-}" ]]; then
  echo "Sending Feishu (outbound ranked)..." >&2
  eval "$(node "$SCRIPT_DIR/monitor-config.js" export-bash)"
  node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 去程 TOP3 推荐" "$RANKED" || true
fi
