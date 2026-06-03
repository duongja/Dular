#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_DIR="${FIBER_RECEIVER_DIR:-$ROOT_DIR/.fiber-node-receiver}"
SOURCE_CONFIG="${FIBER_RECEIVER_SOURCE_CONFIG:-$ROOT_DIR/.fiber-node-fresh/config.yml}"

if [[ "${1:-}" == "--force" ]]; then
  rm -rf "$NODE_DIR"
elif [[ -e "$NODE_DIR/config.yml" ]]; then
  echo "Receiver config already exists: $NODE_DIR/config.yml"
  echo "Use npm run fiber:setup:receiver -- --force to recreate it with a new identity."
  exit 0
fi

if [[ ! -f "$SOURCE_CONFIG" ]]; then
  SOURCE_CONFIG="$ROOT_DIR/../fiber/config/testnet/config.yml"
fi

if [[ ! -f "$SOURCE_CONFIG" ]]; then
  echo "No source Fiber testnet config found." >&2
  echo "Expected $ROOT_DIR/.fiber-node-fresh/config.yml or $ROOT_DIR/../fiber/config/testnet/config.yml" >&2
  exit 1
fi

mkdir -p "$NODE_DIR/ckb" "$NODE_DIR/fiber"
cp "$SOURCE_CONFIG" "$NODE_DIR/config.yml"

perl -0pi -e 's#fiber:\n  listening_addr: "/ip4/0\.0\.0\.0/tcp/\d+"#fiber:\n  listening_addr: "/ip4/0.0.0.0/tcp/8248"#' "$NODE_DIR/config.yml"
perl -0pi -e 's#rpc:\n(?:  # By default RPC only binds to localhost, thus it only allows accessing from the same machine\.\n  # Allowing arbitrary machines to access the JSON-RPC port is dangerous and strongly discouraged\.\n  # Please strictly limit the access to only trusted machines\.\n)?  listening_addr: "127\.0\.0\.1:\d+"#rpc:\n  listening_addr: "127.0.0.1:8247"#' "$NODE_DIR/config.yml"

echo "Receiver Fiber node prepared at $NODE_DIR"
echo "Start it with: npm run fiber:start:receiver"
echo "Then run: npm run fiber:status"

