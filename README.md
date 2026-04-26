# Dular — Stablecoin Payments on Fiber Network

Dular is a modern web interface for instant stablecoin payments built on top of the **[Fiber Network Node (FNN)](https://github.com/nervosnetwork/fiber)** — a Lightning-style Layer 2 payment network for the CKB blockchain.

Dular connects directly to your local FNN node via JSON-RPC to enable:
- **Real-time node monitoring** — view peers, channels, and balances
- **RUSD channel management** — open funded payment channels with relay nodes
- **Instant invoice payments** — pay Fiber invoices off-chain in milliseconds
- **Invoice generation** — create RUSD invoices for receiving payments

![Fiber Network Topology](https://img.shields.io/badge/CKB-Fiber_Network-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Architecture

```
┌─────────────────────┐         ┌──────────────┐         ┌──────────────┐
│   Dular Web App     │  proxy  │  Your FNN    │  p2p    │  Public      │
│   localhost:5173     │───────▶│  Node        │────────▶│  Relay Nodes │
│   (Vite + React)    │  /rpc   │  :8227       │         │  (testnet)   │
└─────────────────────┘         └──────────────┘         └──────────────┘
```

Direct JSON-RPC calls from browsers trigger CORS blocks. Dular solves this with a **Vite dev-server proxy** — the frontend calls `/rpc`, which Vite forwards to `127.0.0.1:8227` transparently. Your node stays isolated from external origins.

---

## Prerequisites

| Requirement | Details |
|-------------|---------|
| **FNN binary** | Download from [Fiber releases](https://github.com/nervosnetwork/fiber/releases) |
| **Node.js** | v18.0+ |
| **Testnet CKB** | ≥561 CKB for channel reserves ([faucet](https://faucet.nervos.org)) |
| **Testnet RUSD** | ≥20 RUSD for UDT channel funding ([faucet](https://testnet0815.stablepp.xyz/faucet)) |

---

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/duongja/Dular.git
cd Dular
npm install
```

### 2. Start the Dev Server

```bash
npm run dev -- --host
```

Dular will be available at **http://localhost:5173/**

> **Note:** The app won't display data until your FNN node is running (Step 3).

---

## Full End-to-End Setup Guide

This guide walks through the complete process of setting up two local Fiber nodes, funding them, opening a payment channel, and executing a stablecoin payment — all tested and verified on CKB testnet.

### Step 1: Set Up FNN Node Directories

Create two node directories — one for the sender (connected to Dular) and one as a local receiver:

```bash
# From your fiber project root
mkdir -p fnn-data/ckb node2-data/ckb
```

Copy the testnet config to both:

```bash
cp config/testnet/config.yml fnn-data/
cp config/testnet/config.yml node2-data/
```

Modify **node2-data/config.yml** to avoid port conflicts:
- Change P2P port: `/ip4/0.0.0.0/tcp/8228` → `/ip4/0.0.0.0/tcp/8238`
- Change RPC port: `127.0.0.1:8227` → `127.0.0.1:8237`

Copy the `fnn` binary into both directories:

```bash
cp target/release/fnn fnn-data/
cp target/release/fnn node2-data/
```

### Step 2: Generate Private Keys

Each node needs a unique 256-bit private key:

```bash
openssl rand -hex 32 > fnn-data/ckb/key
openssl rand -hex 32 > node2-data/ckb/key
```

### Step 3: Start Both Nodes

The `FIBER_SECRET_KEY_PASSWORD` encrypts the private key file on first run. Choose any password — you'll need it every time you restart the node.

```bash
# Terminal 1 — Sender node (Dular connects here)
cd fnn-data
FIBER_SECRET_KEY_PASSWORD='your_password' RUST_LOG=info ./fnn -c config.yml -d .

# Terminal 2 — Receiver node
cd node2-data
FIBER_SECRET_KEY_PASSWORD='your_password' RUST_LOG=info ./fnn -c config.yml -d .
```

Wait for both nodes to finish initializing. You'll see:
```
INFO fnn::ckb::contracts: Creating ContractsContext for testnet
INFO fnn::ckb::config: secret key migration done
```

### Step 4: Get Your Node's CKB Address

Query your sender node to get its lock script args:

```bash
curl -s -H 'content-type: application/json' \
  -d '{"id":1,"jsonrpc":"2.0","method":"node_info","params":[]}' \
  http://127.0.0.1:8227 | python3 -m json.tool
```

Look for the `default_funding_lock_script.args` field — this is your node's CKB lock arg. Convert it to a CKB address using [ckb-cli](https://github.com/nervosnetwork/ckb-cli/releases):

```bash
ckb-cli util key-info --privkey-path fnn-data/ckb/key
```

Or use any CKB address encoder with:
- **code_hash:** `0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8`
- **hash_type:** `type`
- **args:** your lock_args value
- **prefix:** `ckt` (testnet)

### Step 5: Fund Your Wallet

Your node needs both CKB (for gas/reserves) and RUSD (for the payment channel).

#### CKB Faucet
1. Go to https://faucet.nervos.org
2. Paste your CKB testnet address (starts with `ckt1q...`)
3. Request testnet CKB — you need **≥561 CKB** (499 for channel + 61 for change cell + 1 for fees)

#### RUSD Faucet
1. Go to https://testnet0815.stablepp.xyz/faucet
2. The RUSD faucet may require claiming through [JoyID testnet wallet](https://testnet.joyid.dev/) first
3. Transfer **≥20 RUSD** to your node's CKB address
4. Wait for on-chain confirmation (a few minutes)

### Step 6: Connect to Public Relay Node

The Fiber testnet has public relay nodes. Connect to relay node1 before opening a channel:

```bash
curl -s -H 'content-type: application/json' \
  -d '{"id":1,"jsonrpc":"2.0","method":"connect_peer","params":[{"pubkey":"02b6d4e3ab86a2ca2fad6fae0ecb2e1e559e0b911939872a90abdda6d20302be71"}]}' \
  http://127.0.0.1:8227
```

Expected response: `{"jsonrpc":"2.0","result":null,"id":1}` (null = success)

**Public Testnet Node Pubkeys:**
| Node | Pubkey |
|------|--------|
| node1 | `02b6d4e3ab86a2ca2fad6fae0ecb2e1e559e0b911939872a90abdda6d20302be71` |
| node2 | `0291a6576bd5a94bd74b27080a48340875338fff9f6d6361fe6b8db8d0d1912fcc` |

### Step 7: Open an RUSD Channel (via Dular UI)

1. Open **http://localhost:5173** in your browser
2. On the **Dashboard** tab, scroll down to **Open RUSD Channel**
3. Enter:
   - **Peer Pubkey:** `02b6d4e3ab86a2ca2fad6fae0ecb2e1e559e0b911939872a90abdda6d20302be71`
   - **Funding Amount:** `2000000000` (= 20 RUSD in base units, 8 decimal places)
4. Click **Open Channel**

You should see: `Channel opening initiated! ID: 0x...`

> **Important:** The public relay node1 requires a minimum of 20 RUSD (`auto_accept_amount: 0x77359400 = 2,000,000,000`) to auto-accept the channel. Amounts below this threshold will be rejected.

Wait for the channel state to change to **ChannelReady** on the Dashboard. This takes a few minutes as the funding transaction is confirmed on-chain.

You can also monitor via CLI:
```bash
curl -s -H 'content-type: application/json' \
  -d '{"id":1,"jsonrpc":"2.0","method":"list_channels","params":[{}]}' \
  http://127.0.0.1:8227 | python3 -m json.tool
```

### Step 8: Generate an Invoice

To test a payment, generate an invoice on the public testnet node2. First discover its RPC endpoint:

```bash
# Find node2's public IP from the network graph
curl -s -H 'content-type: application/json' \
  -d '{"id":1,"jsonrpc":"2.0","method":"graph_nodes","params":[{}]}' \
  http://127.0.0.1:8227 | python3 -c "
import json,sys
for n in json.load(sys.stdin)['result']['nodes']:
    if n['pubkey'] == '0291a6576bd5a94bd74b27080a48340875338fff9f6d6361fe6b8db8d0d1912fcc':
        print(n['addresses'][0])
"
```

Then generate an invoice for 1 RUSD (`0x5f5e100` = 100,000,000 base units):

```bash
payment_preimage="0x$(openssl rand -hex 32)"

curl -s -H 'content-type: application/json' \
  -d "{\"id\":1,\"jsonrpc\":\"2.0\",\"method\":\"new_invoice\",\"params\":[{
    \"amount\":\"0x5f5e100\",
    \"currency\":\"Fibt\",
    \"description\":\"Test payment\",
    \"expiry\":\"0xe10\",
    \"final_cltv\":\"0x28\",
    \"payment_preimage\":\"$payment_preimage\",
    \"hash_algorithm\":\"sha256\",
    \"udt_type_script\":{
      \"code_hash\":\"0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a\",
      \"hash_type\":\"type\",
      \"args\":\"0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b\"
    }
  }]}" http://<NODE2_IP>:8227
```

Copy the `invoice_address` from the response (starts with `fibt1...`).

### Step 9: Send Payment (via Dular UI)

1. Go to the **Send** tab in Dular
2. Paste the `fibt1...` invoice address
3. Click **Pay Invoice**

You should see: **"Payment initiated successfully!"** 🎉

### Step 10: Verify the Payment

Check updated channel balances:

```bash
curl -s -H 'content-type: application/json' \
  -d '{"id":1,"jsonrpc":"2.0","method":"list_channels","params":[{}]}' \
  http://127.0.0.1:8227 | python3 -c "
import json,sys
for c in json.load(sys.stdin)['result']['channels']:
    local = int(c['local_balance'],16)
    remote = int(c['remote_balance'],16)
    print(f'Local:  {local/100000000:.2f} RUSD')
    print(f'Remote: {remote/100000000:.2f} RUSD')
    print(f'Fee:    {(remote - 100000000)/100000000:.4f} RUSD')
"
```

Expected result after sending 1 RUSD:

| | Before | After |
|---|---|---|
| **Local Balance** | 20.00 RUSD | 19.00 RUSD |
| **Remote Balance** | 0.00 RUSD | 1.00 RUSD |
| **Routing Fee** | — | ~0.001 RUSD |

---

## Dular UI Features

### Dashboard
- Node version, pubkey, and peer count from `node_info` RPC
- Live channel list with state indicators (`ChannelReady`, `Pending`, etc.)
- Local and remote balance display per channel

### Send Payment
- Paste any Fiber invoice (`fibt1...` for testnet, `fibb1...` for mainnet)
- Executes `send_payment` RPC — the payment routes through the network automatically

### Receive (Invoice Generation)
- Generate RUSD invoices via `new_invoice` RPC
- Configurable amount and description
- Copy-to-clipboard for sharing

### Open Channel
- Fund new RUSD payment channels with any connected peer
- Hardcoded RUSD UDT type script for testnet convenience

---

## Configuration

### Vite Proxy

If your FNN node runs on a different port, update `vite.config.js`:

```javascript
server: {
  proxy: {
    '/rpc': {
      target: 'http://127.0.0.1:8227', // Your FNN RPC endpoint
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/rpc/, ''),
    },
  },
}
```

### RUSD Type Script

The testnet RUSD token is configured in `App.jsx`:

```javascript
const RUSD_SCRIPT = {
  code_hash: "0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a",
  hash_type: "type",
  args: "0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b"
}
```

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Failed to execute 'json' on 'Response': Unexpected end of JSON input` | FNN node is not running or crashed | Start the node with correct `FIBER_SECRET_KEY_PASSWORD` |
| `Secret key file error: decryption failed: aead::Error` | Wrong password for encrypted key | Use the same password you set on first run, or wipe `ckb/key` and regenerate |
| `Peer's feature not found, waiting for Init message` | Not connected to the peer yet | Run `connect_peer` RPC first, wait a few seconds, then retry |
| `can not find enough UDT owner cells` | Wallet has no RUSD tokens | Fund with RUSD from the testnet faucet |
| `Insufficient cells available for funding` | Not enough CKB for channel reserves | Need ≥561 CKB from the faucet |
| Blank page / only background visible | React component crash | Check browser console; usually caused by API response shape changes |

---

## Tech Stack

- **Frontend:** Vite 8 + React 19
- **Styling:** Vanilla CSS — dark mode glassmorphism with micro-animations
- **RPC Integration:** Vite proxy → FNN JSON-RPC
- **Blockchain:** CKB Testnet via Fiber Network Protocol

---

## Key RPC Methods Used

| Method | Purpose |
|--------|---------|
| `node_info` | Get node version, pubkey, peer count |
| `list_channels` | List all open payment channels |
| `connect_peer` | Establish P2P connection with a peer |
| `open_channel` | Open a new funded payment channel |
| `new_invoice` | Generate a payment invoice |
| `send_payment` | Pay an invoice through the network |
| `graph_nodes` | Discover nodes in the network graph |
| `shutdown_channel` | Close a channel and settle on-chain |

Full RPC documentation: [FNN RPC Reference](https://github.com/nervosnetwork/fiber/blob/main/crates/fiber-lib/src/rpc/README.md)

---

## License

MIT

---

*Built on CKB Fiber Network for non-custodial, instant stablecoin payments.*
