# Dular — Mobile Money Stablecoin Wallet on Fiber Network

Dular is a browser self-custody stablecoin wallet for mobile money markets. Users verify a phone number, hold their Fiber and CKB keys on-device, move between M-Pesa KES and testnet RUSD, and make direct Fiber payments.

The active product is web-only. The earlier hosted-node PostgreSQL-ledger wallet and USSD implementation remain as archived milestone code, but their money endpoints are disabled unless `LEGACY_MANAGED_WALLET_ENABLED=true`.

## Current State

Shipped in this repo:

- Phone number onboarding with OTP verification through Africa's Talking SMS.
- Phone-to-Fiber identity registry with public lookup endpoint.
- Browser Fiber node startup with PIN-encrypted device-held keys.
- Menu-driven Dashboard, M-Pesa, Receive, Send, and Wallet views.
- Capped, expiring market USD/KES quotes using integer settlement arithmetic.
- Production Daraja STK Push deposits settled by paying an invoice signed by the browser wallet.
- Reusable direct operator-to-browser RUSD channels and delayed-delivery recovery.
- Idempotent ramp orders, callback deduplication, status history, and redacted proof endpoints.
- Operator-signed cash-out invoices, B2C state handling, and browser refund invoices.
- Verification endpoints and scripts for milestone evidence.

Not complete yet:

- B2C production cash-out remains feature-gated until valid M-Pesa initiator/security credentials are available.
- Testnet RUSD is a capped pilot asset and must not be presented as production-money redemption.
- Device recovery and durable background settlement workers remain post-pilot work.
- Pilot-user reporting is planned for Milestone 3.

## User Flow

1. The browser starts a self-custody Fiber node and registers its Fiber identity and CKB funding lock.
2. Dular returns a capped, expiring KES/RUSD market quote.
3. Before requesting M-Pesa, Dular prepares sufficient operator-to-browser RUSD capacity.
4. The browser signs an invoice for the exact quoted RUSD and the API validates its payee, asset, amount, description, hash, and expiry.
5. Dular requests an STK Push and independently reconciles the checkout through Daraja.
6. After confirmed KES receipt, the operator pays the browser invoice exactly once.
7. The order completes only after Fiber payment success; no PostgreSQL user balance is credited.

Technical proof is hidden under "Proof details" in the UI so the product feels end-user facing while still exposing payment hashes and checkout IDs for verification.

## Architecture

```text
React browser wallet
  |
  | /api
  v
Express API
  |-- PostgreSQL phone registry, quotes, ramp orders, events, and evidence
  |-- Africa's Talking SMS OTP
  |-- Safaricom Daraja STK Push, query, and feature-gated B2C
  `-- Authenticated Fiber operator RPC

Browser Fiber node <-- public WSS --> Dular Fiber operator

CKB public testnet
  `-- Fiber payment channel funding and RUSD UDT settlement
```

Important distinction:

- A Fiber payment hash is an off-chain Fiber payment identifier.
- It is not a CKB L1 transaction hash and should not be expected to appear directly on the CKB explorer.
- CKB explorer verification applies to channel lifecycle/funding cells.
- Multi-hop or direct Fiber route proof comes from Fiber RPC payment records such as `list_payments`.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | Vite + React |
| Styling | Custom CSS, mobile-first fintech UI |
| API | Express |
| Database | PostgreSQL |
| OTP SMS | Africa's Talking |
| M-Pesa | Safaricom Daraja |
| Payment network | Fiber Network on CKB testnet |
| Stablecoin | RUSD UDT |

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy the sample env file:

```bash
cp .env.example .env
```

Set at minimum:

```bash
DATABASE_URL=
SESSION_SECRET=
PUBLIC_BASE_URL=
FIBER_RPC_URL=http://127.0.0.1:8227
FIBER_GATEWAY_RPC_TOKEN=
FIBER_OPERATOR_WS_ADDR=
```

For live integrations, also set:

```bash
DEMO_MODE=false
AT_USERNAME=
AT_API_KEY=
AT_SENDER_ID=
MPESA_ENVIRONMENT=production
MPESA_CONSUMER_KEY=
MPESA_CONSUMER_SECRET=
MPESA_SHORTCODE=
MPESA_PASSKEY=
MPESA_B2C_SHORTCODE=
MPESA_INITIATOR_NAME=
MPESA_SECURITY_CREDENTIAL=
MPESA_TIMEOUT_URL=
RAMP_DEPOSITS_ENABLED=true
RAMP_WITHDRAWALS_ENABLED=false
RAMP_CALLBACK_TOKEN=<long-random-token>
RAMP_OPERATOR_TOKEN=<different-long-random-token>
RAMP_MIN_KES=10
RAMP_MAX_KES=1000
RAMP_FEE_BPS=25
RAMP_USD_KES_RATE=
```

Do not commit `.env`.

### Vercel API Deployment

The backend can be deployed to Vercel as a public Milestone 1 API. Vercel runs the Express app through `api/index.js`, while local development still uses `npm run dev:api`.

Set these Vercel environment variables first:

```bash
DATABASE_URL=
SESSION_SECRET=
PUBLIC_BASE_URL=https://<your-vercel-domain>
DEMO_MODE=false
OTP_DEMO_MODE=true
FIBER_RPC_URL=https://<railway-fiber-domain>/rpc
FIBER_GATEWAY_RPC_TOKEN=<same-token-configured-on-railway>
FIBER_OPERATOR_WS_ADDR=/dns4/<railway-fiber-domain>/tcp/443/wss
RAMP_DEPOSITS_ENABLED=true
RAMP_WITHDRAWALS_ENABLED=false
RAMP_CALLBACK_TOKEN=<long-random-token>
RAMP_OPERATOR_TOKEN=<different-long-random-token>
RAMP_MIN_KES=10
RAMP_MAX_KES=1000
RAMP_FEE_BPS=25
```

Use `OTP_DEMO_MODE=true` for reviewer/test deployments when Africa's Talking SMS is not live yet. This keeps the database/API live while returning the visible OTP code `123456` in the app. Set `OTP_DEMO_MODE=false` only after `AT_USERNAME`, `AT_API_KEY`, and the approved sender route are working.

For browser self-custody testing on Vercel, deploy the hosted Fiber operator first. See `railway/fiber/README.md`.

For the public lookup proof, seed at least one reviewer-safe phone record after migrations:

```bash
npm run migrate
npm run registry:seed -- +254700000001 <actual_fiber_pubkey>
```

Reviewer check:

```bash
curl "https://<your-vercel-domain>/api/registry/lookup?phone=%2B254700000001"
```

Expected response includes `phone`, `fiberPubkey`, `verifiedAt`, and `lookupProof.publicEndpoint`.

### 3. Run Database Migrations

```bash
npm run migrate
```

### 4. Start the Fiber Operator

For local development, start the operator node:

```bash
export FIBER_SECRET_KEY_PASSWORD='your-node-password'
npm run fiber:start:payer
```

The operator must have enough testnet CKB and RUSD for capped browser channels. Dular prepares the exact route before it starts an STK Push, so insufficient operator liquidity cannot collect KES first.

### 5. Start API and Frontend

```bash
npm run dev:api
```

```bash
npm run dev -- --host 0.0.0.0
```

Open:

```text
http://localhost:5173
```

## Main Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start Vite frontend |
| `npm run dev:api` | Start Express API |
| `npm run migrate` | Apply PostgreSQL schema |
| `npm test` | Run ramp arithmetic, invoice, and state-machine tests |
| `npm run fiber:status` | Inspect payer/receiver Fiber nodes |
| `npm run fiber:connect-local` | Connect payer node to receiver node |
| `npm run fiber:open-receiver` | Open payer-to-receiver RUSD channel |
| `npm run fiber:receiver-invoice` | Create receiver invoice from CLI |
| `npm run fiber:pay` | Pay a Fiber invoice from CLI |
| `npm run check:daraja` | Verify Daraja token credentials |
| `npm run check:stk-status -- <CheckoutRequestID>` | Query STK status |
| `npm run lint` | Run ESLint |
| `npm run build` | Build frontend |

## API Overview

Important endpoints:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/request-otp` | Send OTP to phone |
| `POST /api/auth/verify-otp` | Verify OTP and create session |
| `GET /api/me` | Current verified user |
| `GET /api/registry/lookup?phone=...` | Phone-to-Fiber identity lookup |
| `POST /api/fiber/register-device` | Bind a browser Fiber pubkey and CKB lock after OTP verification and signed Fiber-invoice proof |
| `GET /api/ramp/config` | Pilot limits and ramp availability |
| `POST /api/ramp/quotes` | Create an expiring market-rate quote |
| `POST /api/ramp/deposits` | Create an idempotent browser deposit order |
| `PUT /api/ramp/deposits/:id/invoice` | Validate and bind the browser invoice |
| `POST /api/ramp/deposits/:id/stk` | Start STK only after route/invoice validation |
| `POST /api/ramp/orders/:id/reconcile` | Reconcile M-Pesa and Fiber settlement |
| `POST /api/ramp/withdrawals` | Create a feature-gated cash-out order |
| `GET /api/verification/ramp/:id` | Redacted completed-order evidence |

Legacy `/api/mpesa/*`, PostgreSQL phone-payment, and `/api/ussd` money paths return `410` unless explicitly re-enabled for historical verification.

## Verification

Milestone verification artifacts are under:

```text
verification/milestone-1/
WEB_MPESA_RAMP.md
```

Useful checks:

```bash
curl http://localhost:8787/api/verification/ramp/<completed-order-id>
npm run check:stk-status -- <CheckoutRequestID>
npm run fiber:status
```

The ramp verification endpoint shows:

- M-Pesa checkout/request IDs.
- Deposit status and receipt when available.
- Browser-signed Fiber invoice.
- Fiber payment hash/status when settlement succeeds.
- Immutable quote arithmetic and order-state history.

## Troubleshooting

| Problem | Likely Cause | Fix |
| --- | --- | --- |
| Deposit cannot continue before STK | No single ready operator-to-browser RUSD channel can carry the quote | Keep the browser open, confirm operator RUSD/CKB, and resume route preparation |
| Order is `delivery_pending` | KES is confirmed but the browser invoice could not settle | Reopen the browser wallet and reconcile the same order; never create a second STK order |
| `M-Pesa request status needs support review` | STK submission became ambiguous before a checkout ID was stored | Reconcile against Daraja/operator records; do not retry automatically |
| Cash-out unavailable | B2C credentials or feature flag are incomplete | Keep `RAMP_WITHDRAWALS_ENABLED=false` until production credentials pass verification |
| Fiber gateway returns `401` | Gateway/backend RPC tokens do not match | Set the same `FIBER_GATEWAY_RPC_TOKEN` on Railway and the API deployment |
| SMS not received | Sender ID/route/account issue | Check Africa's Talking dashboard and SMS status |

## Security Notes

- Never commit `.env`.
- Do not put GitHub tokens, Daraja credentials, Africa's Talking keys, or Fiber passwords in Git remotes or source files.
- Fiber node start scripts require `FIBER_SECRET_KEY_PASSWORD` from the shell environment.
- `DEMO_MODE=true` is intended only for local mock development.
- Keep `LEGACY_MANAGED_WALLET_ENABLED=false` for the self-custody product.
- Use separate long random `RAMP_CALLBACK_TOKEN` and `RAMP_OPERATOR_TOKEN` values. The latter protects audited provider adjudication and must never appear in callback URLs or browser configuration.

## License

MIT

---

Dular: instant stablecoin payments for mobile money markets, no banks, no borders, no middlemen. Just your phone number.
