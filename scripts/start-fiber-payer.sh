#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FNN_BIN="${FNN_BIN:-$ROOT_DIR/../fiber/fnn-data/fnn}"
NODE_DIR="${FIBER_PAYER_DIR:-$ROOT_DIR/.fiber-node-fresh}"

if [[ ! -x "$FNN_BIN" ]]; then
  echo "FNN binary not found or not executable: $FNN_BIN" >&2
  exit 1
fi

if [[ -z "${FIBER_SECRET_KEY_PASSWORD:-}" ]]; then
  echo "Set FIBER_SECRET_KEY_PASSWORD before starting the payer Fiber node." >&2
  exit 1
fi

exec env FIBER_SECRET_KEY_PASSWORD="$FIBER_SECRET_KEY_PASSWORD" RUST_LOG="${RUST_LOG:-info}" \
  "$FNN_BIN" -c "$NODE_DIR/config.yml" -d "$NODE_DIR"
