#!/usr/bin/env bash
# Load .env from project root (if present). Safe to source multiple times.
set -a
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT_DIR/.env" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
fi
set +a
