#!/usr/bin/env bash
set -euo pipefail

FIBER_HOME="${FIBER_HOME:-/data}"
FIBER_NETWORK="${FIBER_NETWORK:-testnet}"
FIBER_CONFIG="${FIBER_CONFIG:-$FIBER_HOME/config.yml}"
FIBER_CONFIG_TEMPLATE="${FIBER_CONFIG_TEMPLATE:-/usr/local/share/fiber/config/$FIBER_NETWORK/config.yml}"
FIBER_RPC_LISTEN="${FIBER_RPC_LISTEN:-127.0.0.1:8227}"
FIBER_P2P_LISTEN="${FIBER_P2P_LISTEN:-/ip4/127.0.0.1/tcp/8228}"
CKB_RPC_URL="${CKB_RPC_URL:-https://testnet.ckb.dev/}"

if [[ -z "${FIBER_SECRET_KEY_PASSWORD:-}" ]]; then
  echo "FIBER_SECRET_KEY_PASSWORD must be set." >&2
  exit 1
fi

if [[ ! -f "$FIBER_CONFIG_TEMPLATE" ]]; then
  echo "Fiber config template not found: $FIBER_CONFIG_TEMPLATE" >&2
  exit 1
fi

mkdir -p "$FIBER_HOME/ckb" "$FIBER_HOME/fiber"

if [[ ! -f "$FIBER_HOME/ckb/key" ]]; then
  node --input-type=module <<'KEYGEN'
import crypto from 'node:crypto'
import fs from 'node:fs'
const ckbKeyPath = `${process.env.FIBER_HOME}/ckb/key`
if (!fs.existsSync(ckbKeyPath)) {
  const plainHex = crypto.randomBytes(32).toString('hex')
  fs.mkdirSync(`${process.env.FIBER_HOME}/ckb`, { recursive: true })
  fs.writeFileSync(ckbKeyPath, plainHex)
  console.log(`Generated plaintext CKB key at ${ckbKeyPath} (will be auto-encrypted by Fiber)`)
}
KEYGEN
fi

if [[ ! -f "$FIBER_CONFIG" ]]; then
  cp "$FIBER_CONFIG_TEMPLATE" "$FIBER_CONFIG"
  echo "Created Fiber config at $FIBER_CONFIG"
fi

export FIBER_CONFIG FIBER_P2P_LISTEN FIBER_RPC_LISTEN CKB_RPC_URL
node --input-type=module <<'NODE'
import fs from 'node:fs'

const path = process.env.FIBER_CONFIG
let config = fs.readFileSync(path, 'utf8')

config = config.replace(
  /fiber:\n  listening_addr: "[^"]+"/,
  `fiber:\n  listening_addr: "${process.env.FIBER_P2P_LISTEN}"`,
)
config = config.replace('announce_listening_addr: true', 'announce_listening_addr: false')
config = config.replace(
  /rpc:\n(?:  #.*\n)*  listening_addr: "[^"]+"/,
  `rpc:\n  listening_addr: "${process.env.FIBER_RPC_LISTEN}"`,
)
config = config.replace(
  /ckb:\n(?:  #.*\n)*  rpc_url: "[^"]+"/,
  `ckb:\n  rpc_url: "${process.env.CKB_RPC_URL}"`,
)

fs.writeFileSync(path, config)
NODE

RUST_LOG="${RUST_LOG:-info}" FIBER_SECRET_KEY_PASSWORD="$FIBER_SECRET_KEY_PASSWORD" \
  fnn -c "$FIBER_CONFIG" -d "$FIBER_HOME" &

fiber_pid=$!
node /app/gateway.js &
gateway_pid=$!

cleanup() {
  kill "$fiber_pid" 2>/dev/null || true
  kill "$gateway_pid" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

while true; do
  if ! kill -0 "$fiber_pid" 2>/dev/null; then
    echo "Fiber node exited; stopping gateway." >&2
    cleanup
    wait "$fiber_pid" 2>/dev/null || exit 1
  fi

  if ! kill -0 "$gateway_pid" 2>/dev/null; then
    echo "Gateway exited; stopping Fiber node." >&2
    cleanup
    wait "$gateway_pid" 2>/dev/null || exit 1
  fi

  sleep 2
done
