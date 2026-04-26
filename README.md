# Dular — Mobile Money Stablecoin Wallet

**Dular** is an open-source stablecoin wallet designed for **mobile money markets**. It brings instant, near-zero-fee stablecoin transfers to communities that rely on mobile money — replacing slow settlement rails and high remittance fees with cryptographically secured, non-custodial payments powered by the [Fiber Network](https://github.com/nervosnetwork/fiber) on CKB blockchain.

In markets across Africa, Southeast Asia, and Latin America, mobile money is the financial backbone for hundreds of millions of people. But cross-border transfers are expensive (6–9% fees), settlements are slow (1–3 business days), and users are locked into closed ecosystems. **Dular changes this** — anyone with a phone can send and receive stablecoins instantly for fractions of a cent.

---

## Why Dular?

| Mobile Money Today | Dular |
|---|---|
| 6–9% cross-border fees | **< 0.001% routing fees** |
| 1–3 day settlement | **Instant** (millisecond finality) |
| Closed, siloed networks | **Open protocol**, interoperable |
| Custodial, operator-controlled | **Non-custodial**, you hold your keys |
| Requires banking infrastructure | **Peer-to-peer**, no intermediaries |
| Currency volatility | **Stablecoin-native** (RUSD, USDT) |

---

## How It Works

Dular is built on the **Fiber Network** — a Lightning-style Layer 2 payment network for CKB blockchain. Instead of settling every transaction on-chain (slow and expensive), Dular opens **payment channels** between peers and executes transfers off-chain in milliseconds. Only the channel open/close hits the blockchain.

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│  Sender      │  ⚡     │  Relay       │  ⚡     │  Receiver    │
│  (Dular App) │────────▶│  Node        │────────▶│  (Dular App) │
│              │ instant │  (network)   │ instant │              │
└──────────────┘         └──────────────┘         └──────────────┘
        │                                                 │
        └─────── Off-chain stablecoin transfer ───────────┘
                    Fee: ~0.001 RUSD ($0.001)
```

### Key Technology
- **Payment Channels:** Open once, transact unlimited times off-chain
- **Multi-hop Routing:** Payments find the cheapest path through the network automatically
- **PTLC Security:** Point Time-Locked Contracts ensure atomic, trustless transfers
- **Stablecoin-Native:** Built specifically for UDT stablecoins — no volatile crypto exposure

---

## Features

### 💸 Send Money Instantly
Paste any Fiber invoice and pay in milliseconds. No waiting for block confirmations. No intermediary banks. Just instant value transfer.

### 📲 Receive Payments
Generate stablecoin invoices with custom amounts and descriptions. Share the invoice string — the sender pays from anywhere in the Fiber network.

### 📊 Wallet Dashboard
Real-time view of your node's connections, open payment channels, and stablecoin balances. Know exactly where your money is at all times.

### 🔗 Channel Management
Open funded stablecoin channels directly from the UI. Connect to relay nodes to access the broader payment network.

---

## Getting Started

### Prerequisites

| Requirement | Details |
|-------------|---------|
| **FNN binary** | Download from [Fiber releases](https://github.com/nervosnetwork/fiber/releases) |
| **Node.js** | v18.0+ |
| **Testnet CKB** | ≥561 CKB for channel reserves ([faucet](https://faucet.nervos.org)) |
| **Testnet RUSD** | ≥20 RUSD for channel funding ([faucet](https://testnet0815.stablepp.xyz/faucet)) |

### Quick Start

```bash
git clone https://github.com/duongja/Dular.git
cd Dular
npm install
npm run dev -- --host
```

Open **http://localhost:5173** — Dular connects to your local Fiber node automatically.

---

## Full Setup Guide

### 1. Set Up Your Fiber Node

Create a node directory and generate a wallet key:

```bash
mkdir -p my-node/ckb
cp config/testnet/config.yml my-node/
cp fnn my-node/
openssl rand -hex 32 > my-node/ckb/key
```

Start the node:

```bash
cd my-node
FIBER_SECRET_KEY_PASSWORD='your_password' RUST_LOG=info ./fnn -c config.yml -d .
```

### 2. Fund Your Wallet

Get your CKB address from the node info:

```bash
curl -s -H 'content-type: application/json' \
  -d '{"id":1,"jsonrpc":"2.0","method":"node_info","params":[]}' \
  http://127.0.0.1:8227
```

Fund it from the testnet faucets:
- **CKB:** https://faucet.nervos.org (≥561 CKB)
- **RUSD:** https://testnet0815.stablepp.xyz/faucet (≥20 RUSD)

### 3. Connect to the Network

Connect to a public relay node so you can send/receive through the network:

```bash
curl -s -H 'content-type: application/json' \
  -d '{"id":1,"jsonrpc":"2.0","method":"connect_peer","params":[{"pubkey":"02b6d4e3ab86a2ca2fad6fae0ecb2e1e559e0b911939872a90abdda6d20302be71"}]}' \
  http://127.0.0.1:8227
```

### 4. Open a Payment Channel

In the Dular UI → **Dashboard** → **Open RUSD Channel**:
- **Peer Pubkey:** `02b6d4e3ab86a2ca2fad6fae0ecb2e1e559e0b911939872a90abdda6d20302be71`
- **Funding Amount:** `2000000000` (= 20 RUSD)

Wait for `ChannelReady` status — your wallet is now live.

### 5. Send Your First Payment

Generate a test invoice on the public testnet node:

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
  }]}" http://<RELAY_NODE_IP>:8227
```

Copy the `fibt1...` invoice → paste in Dular **Send** tab → **Pay Invoice** → Done! ⚡

---

## Architecture

```
┌─────────────────────┐         ┌──────────────┐         ┌──────────────┐
│   Dular Web App     │  proxy  │  Fiber Node  │  p2p    │  Fiber       │
│   (Vite + React)    │───────▶│  (local)     │────────▶│  Network     │
│   localhost:5173     │  /rpc   │  :8227       │         │  (global)    │
└─────────────────────┘         └──────────────┘         └──────────────┘
```

The Dular frontend communicates with your local Fiber node through a Vite dev-server proxy. Your node handles all P2P networking, channel management, and payment routing. Your private keys never leave your machine.

### Configuration

Update `vite.config.js` if your node runs on a different port:

```javascript
server: {
  proxy: {
    '/rpc': {
      target: 'http://127.0.0.1:8227',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/rpc/, ''),
    },
  },
}
```

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Unexpected end of JSON input` | Fiber node not running | Start node with correct `FIBER_SECRET_KEY_PASSWORD` |
| `decryption failed: aead::Error` | Wrong key password | Use original password, or wipe `ckb/key` and regenerate |
| `Peer's feature not found` | Not connected to peer | Run `connect_peer` first, wait a few seconds |
| `can not find enough UDT owner cells` | No RUSD in wallet | Fund from RUSD testnet faucet |
| `Insufficient cells for funding` | Not enough CKB | Need ≥561 CKB from faucet |
| Blank page | React component crash | Check browser console; refresh after node starts |

---

## Roadmap

- [ ] **Mobile-first PWA** — responsive design optimized for smartphones
- [ ] **QR code scanning** — scan invoices with phone camera
- [ ] **Contact list** — save frequent recipients
- [ ] **Transaction history** — searchable payment log
- [ ] **Mobile money on/off ramp** — M-Pesa, MTN MoMo, Airtel Money integration
- [ ] **Multi-currency support** — USDT, USDC, local stablecoin bridges
- [ ] **Offline-capable** — queue payments when connectivity is poor
- [ ] **SMS fallback** — send payments via SMS for feature phones
- [ ] **Agent network tools** — cash-in/cash-out management for local agents

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vite 8 + React 19 |
| Styling | Vanilla CSS (dark mode, glassmorphism) |
| Payment Protocol | Fiber Network (PTLC-based L2) |
| Blockchain | CKB (Nervos Network) |
| Stablecoin | RUSD (UDT standard) |

---

## Contributing

Dular is open source and built for communities that need it most. We welcome contributions — especially from developers in mobile money markets who understand the real-world constraints.

```bash
# Clone and run locally
git clone https://github.com/duongja/Dular.git
cd Dular && npm install && npm run dev
```

---

## License

MIT

---

*Dular: Bringing instant, zero-fee stablecoin payments to mobile money markets — no banks, no borders, no middlemen.*
