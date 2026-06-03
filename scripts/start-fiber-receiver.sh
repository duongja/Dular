#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FNN_BIN="${FNN_BIN:-$ROOT_DIR/../fiber/fnn-data/fnn}"
NODE_DIR="${FIBER_RECEIVER_DIR:-$ROOT_DIR/.fiber-node-receiver}"

if [[ ! -x "$FNN_BIN" ]]; then
  echo "FNN binary not found or not executable: $FNN_BIN" >&2
  exit 1
fi

if [[ ! -f "$NODE_DIR/config.yml" ]]; then
  echo "Receiver node config not found: $NODE_DIR/config.yml" >&2
  echo "Create it from the payer config and change RPC/P2P ports to 8247/8248." >&2
  exit 1
fi

if [[ -z "${FIBER_SECRET_KEY_PASSWORD:-}" ]]; then
  echo "Set FIBER_SECRET_KEY_PASSWORD before starting the receiver Fiber node." >&2
  exit 1
fi

exec env FIBER_SECRET_KEY_PASSWORD="$FIBER_SECRET_KEY_PASSWORD" RUST_LOG="${RUST_LOG:-info}" \
  "$FNN_BIN" -c "$NODE_DIR/config.yml" -d "$NODE_DIR"
