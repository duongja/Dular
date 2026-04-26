# Dular — Mobile Money Stablecoin Wallet

**Dular** is an open-source stablecoin wallet designed for **mobile money markets**. It brings instant, near-zero-fee stablecoin transfers to the 1.4 billion people who depend on mobile money — replacing slow settlement rails and high remittance fees with cryptographically secured, non-custodial payments powered by the [Fiber Network](https://github.com/nervosnetwork/fiber) on CKB blockchain.

In markets across Africa, Southeast Asia, and Latin America, mobile money is the financial backbone. But cross-border transfers cost 6–9%, settlements take days, and users are locked into closed ecosystems. **Dular changes this** — anyone with a phone can send and receive stablecoins instantly, using just their phone number.

---

## The Problem

| Mobile Money Today | Dular |
|---|---|
| 6–9% cross-border fees | **< 0.001% routing fees** |
| 1–3 day settlement | **Instant** (millisecond finality) |
| Closed, siloed networks | **Open protocol**, interoperable |
| Custodial, operator-controlled | **Non-custodial**, you hold your keys |
| Requires banking infrastructure | **Peer-to-peer**, no intermediaries |
| Currency volatility | **Stablecoin-native** (RUSD) |
| Complex crypto addresses | **Phone number identity** |
| Smartphones required | **USSD support** for feature phones |

---

## How It Works

Dular is built on the **Fiber Network** — a Lightning-style Layer 2 payment network for CKB blockchain. Instead of settling every transaction on-chain, Dular opens **payment channels** between peers and executes transfers off-chain in milliseconds. Only the channel open/close hits the blockchain.

```
┌──────────────────┐       ┌──────────────┐       ┌──────────────────┐
│  Sender          │  ⚡   │  Relay       │  ⚡   │  Receiver        │
│  Phone: +254...  │──────▶│  Node        │──────▶│  Phone: +233...  │
│  (Dular App)     │  <1s  │  (network)   │  <1s  │  (Dular App)     │
└──────────────────┘       └──────────────┘       └──────────────────┘
        │                                                   │
        └──────── Off-chain stablecoin transfer ────────────┘
                      Fee: ~$0.001
```

### Key Technology
- **Phone Number Identity** — Send money to phone numbers, not hex addresses. Dular maps phone numbers to Fiber pubkeys behind the scenes.
- **Payment Channels** — Open once, transact unlimited times off-chain
- **Multi-hop Routing** — Payments find the cheapest path through the network automatically
- **PTLC Security** — Point Time-Locked Contracts ensure atomic, trustless transfers
- **Stablecoin-Native** — Built specifically for UDT stablecoins — no volatile crypto exposure
- **USSD Interface** — Feature phone support via USSD menus — no smartphone or internet required
- **M-Pesa On/Off Ramp** — Convert between mobile money and stablecoins seamlessly

---

## Features

### Current (v0.1 — Shipped ✅)

- **💸 Instant Payments** — Pay any Fiber invoice in milliseconds via the web UI
- **📲 Invoice Generation** — Create RUSD invoices with custom amounts and descriptions
- **📊 Wallet Dashboard** — Real-time view of channels, balances, and node connections
- **🔗 Channel Management** — Open and fund RUSD payment channels from the UI
- **🛡️ Non-Custodial** — Your keys stay on your machine, always

### Phase 2 — In Development 🔨

- **📱 Phone Number Identity** — Send to `+254712345678` instead of `02b6d4e3...`
- **💱 M-Pesa On/Off Ramp** — Deposit KES via M-Pesa → receive RUSD. Withdraw RUSD → receive KES via M-Pesa
- **📟 USSD Support** — `Dial *384*55#` to send/receive stablecoins from any phone (no internet needed)
- **👥 30-User Pilot** — Structured testing with real users in Kenya and Ghana

### Phase 3 — Roadmap 🗺️

- **🏦 Local Stablecoins** — Launch market-specific stablecoins (KES-pegged, GHS-pegged, NGN-pegged)
- **🌍 Multi-corridor Remittance** — Kenya ↔ Ghana, Nigeria ↔ Kenya, Uganda ↔ Tanzania
- **🤝 Agent Network** — Cash-in/cash-out management tools for local agents
- **📴 Offline Payments** — Queue and sync payments when connectivity is poor
- **📊 Merchant Tools** — Payment acceptance for small businesses and market vendors

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

Get your CKB address from node info:

```bash
curl -s -H 'content-type: application/json' \
  -d '{"id":1,"jsonrpc":"2.0","method":"node_info","params":[]}' \
  http://127.0.0.1:8227
```

Fund from testnet faucets:
- **CKB:** https://faucet.nervos.org (≥561 CKB)
- **RUSD:** https://testnet0815.stablepp.xyz/faucet (≥20 RUSD)

### 3. Connect to the Network

```bash
curl -s -H 'content-type: application/json' \
  -d '{"id":1,"jsonrpc":"2.0","method":"connect_peer","params":[{"pubkey":"02b6d4e3ab86a2ca2fad6fae0ecb2e1e559e0b911939872a90abdda6d20302be71"}]}' \
  http://127.0.0.1:8227
```

### 4. Open a Payment Channel (via Dular UI)

- Navigate to **Dashboard** → **Open RUSD Channel**
- **Peer Pubkey:** `02b6d4e3ab86a2ca2fad6fae0ecb2e1e559e0b911939872a90abdda6d20302be71`
- **Funding Amount:** `2000000000` (= 20 RUSD)
- Wait for `ChannelReady` status

### 5. Send Your First Payment

Generate an invoice on a remote node and paste the `fibt1...` string into the **Send** tab. Click **Pay Invoice** — payment settles in under a second.

---

## Architecture

```
┌─────────────────────┐         ┌──────────────┐         ┌──────────────┐
│   Dular Interface    │  proxy  │  Fiber Node  │  p2p    │  Fiber       │
│   Web / USSD / SMS  │───────▶│  (local)     │────────▶│  Network     │
│                     │  /rpc   │  :8227       │         │  (global)    │
└─────────────────────┘         └──────────────┘         └──────────────┘
         │                             │
    ┌────┴────┐                  ┌─────┴─────┐
    │ Phone # │                  │  M-Pesa   │
    │ Registry│                  │  Gateway  │
    └─────────┘                  └───────────┘
```

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

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vite 8 + React 19 |
| Styling | Vanilla CSS (dark mode, glassmorphism) |
| Payment Protocol | Fiber Network (PTLC-based L2) |
| Blockchain | CKB (Nervos Network) |
| Stablecoin | RUSD (UDT standard) |
| On/Off Ramp | M-Pesa Daraja API (planned) |
| Feature Phones | USSD via Africa's Talking API (planned) |

---

## Contributing

Dular is open source and built for communities that need it most. We welcome contributions — especially from developers in mobile money markets who understand real-world constraints.

```bash
git clone https://github.com/duongja/Dular.git
cd Dular && npm install && npm run dev
```

---

## License

MIT

---

*Dular: Instant stablecoin payments for mobile money markets — no banks, no borders, no middlemen. Just your phone number.*
