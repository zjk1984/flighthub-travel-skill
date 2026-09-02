#!/usr/bin/env bash
# Skill: 新疆 → 广东 返程监控（独立运行，需先去程 JSONL 或单独查返程）
# Usage: bash scripts/monitor-return.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"
source "$SCRIPT_DIR/load-env.sh"
# shellcheck source=feishu-env.sh
source "$SCRIPT_DIR/feishu-env.sh"

RESULTS="$ROOT_DIR/reports/xinjiang-results.jsonl"
OUTPUT="$ROOT_DIR/reports/xinjiang-flights-latest.md"
RANKED="$ROOT_DIR/reports/xinjiang-flights-ranked.md"

if [[ ! -f "$RESULTS" ]]; then
  echo "Warning: $RESULTS 不存在，将仅查询返程航线" >&2
fi

echo "▶ 返程 Skill：查询新疆 → 广东 + custom + 合并报告" >&2
echo "  建议距去程 Skill 至少 30 分钟" >&2
node "$SCRIPT_DIR/monitor-run.js" --phase return "$RESULTS" "$OUTPUT" "$RANKED"

if feishu_notify_enabled; then
  echo "Sending Feishu (full ranked)..." >&2
  eval "$(node "$SCRIPT_DIR/monitor-config.js" export-bash)"
  node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 每日 TOP3 航班推荐" "$RANKED" || true
fi
