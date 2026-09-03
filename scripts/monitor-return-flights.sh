#!/usr/bin/env bash
# 仅查询返程航班（跳过酒店、行程卡片、旅行计划）
# Usage: bash scripts/monitor-return-flights.sh [--refresh]
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

REFRESH=false
for arg in "$@"; do
  if [[ "$arg" == "--refresh" ]]; then REFRESH=true; fi
done

if [[ "$REFRESH" == "true" ]]; then
  node -e "
const fs=require('fs');
const cachePath='reports/flight-route-cache.jsonl';
const resultsPath='reports/xinjiang-results.jsonl';
function purge(file, pred) {
  if(!fs.existsSync(file)) return 0;
  const lines=fs.readFileSync(file,'utf8').split('\n').filter(Boolean);
  const kept=lines.filter(l=>{ try { return !pred(JSON.parse(l)); } catch { return true; } });
  fs.writeFileSync(file, kept.join('\n')+(kept.length?'\n':''));
  return lines.length-kept.length;
}
const isReturn=(r)=> (r.route==='伊宁→广州'&&r.date==='2026-10-08') || (r.origin==='伊宁'&&r.dest==='广州'&&r.date==='2026-10-08');
console.error('Refresh: purged cache', purge(cachePath, isReturn), 'results', purge(resultsPath, isReturn));
"
fi

echo "▶ 返程航班（仅机票，不含酒店/行程）" >&2
node "$SCRIPT_DIR/monitor-run.js" --phase return --flights-only "$RESULTS" "$OUTPUT" "$RANKED"

if feishu_notify_enabled; then
  eval "$(node "$SCRIPT_DIR/monitor-config.js" export-bash)"
  echo "Sending Feishu (ranked only)..." >&2
  node "$SCRIPT_DIR/feishu-notify.js" --title "${ROUTE_LABEL} 返程 TOP3" "$RANKED" || true
fi
