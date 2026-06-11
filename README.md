# Dular — Mobile Money Stablecoin Wallet on Fiber Network

Dular is a phone-number stablecoin wallet for mobile money markets. It lets users verify a phone number, deposit from M-Pesa, receive RUSD, send RUSD to another Dular phone number, and track every payment in a mobile-first wallet UI.

The current implementation is focused on Spark Milestone 1: phone identity, M-Pesa STK deposit, testnet-backed Fiber settlement, and end-user wallet UX.

## Current State

Shipped in this repo:

- Phone number onboarding with OTP verification through Africa's Talking SMS.
- Phone-to-Fiber identity registry with public lookup endpoint.
- Production-style mobile wallet UI with Home, Deposit, Send, Withdraw, Activity, and Account screens.
- M-Pesa STK Push deposit flow using Daraja.
- Background receiver Fiber invoice generation for deposits.
- Public testnet Fiber settlement from the Dular payer node to a separate receiver node.
- Daraja STK status reconciliation, so deposits can complete even when callbacks are delayed or missed.
- Unified activity feed for M-Pesa deposits/withdrawals and Dular phone-to-phone sends/receives.
- Verification endpoints and scripts for milestone evidence.

Not complete yet:

- B2C withdrawal production flow depends on valid M-Pesa initiator/security credential setup.
- USSD interface is planned for Milestone 2.
- Pilot-user reporting is planned for Milestone 3.

## User Flow

1. User verifies their M-Pesa phone number.
2. User enters a deposit amount in KES.
3. Dular creates a receiver-node Fiber invoice in the background.
4. Dular sends an M-Pesa STK Push to the user's phone.
5. After M-Pesa succeeds, Dular pays the receiver Fiber invoice with public testnet RUSD.
6. The in-app RUSD ledger is credited only after Fiber payment success.
7. User can send RUSD to another verified Dular phone number.

Technical proof is hidden under "Proof details" in the UI so the product feels end-user facing while still exposing payment hashes and checkout IDs for verification.

## Architecture

```text
React wallet UI
  |
  | /api
  v
Express API
  |-- PostgreSQL ledger, phone registry, sessions, transactions
  |-- Africa's Talking SMS OTP
  |-- Safaricom Daraja STK Push + STK query
  |-- Fiber payer node RPC :8227
  `-- Fiber receiver node RPC :8247

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
FIBER_RECEIVER_RPC_URL=http://127.0.0.1:8247
FIBER_RECEIVER_CKB_ADDRESS=
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
USSD_ENABLED=true
USSD_WITHDRAWALS_ENABLED=false
USSD_SERVICE_CODE=*483*XXXX#
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
```

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

### 4. Start Fiber Nodes

The Milestone 1 deposit flow uses two local Fiber nodes:

- Payer node: `http://127.0.0.1:8227`
- Receiver node: `http://127.0.0.1:8247`

Create/configure the receiver node:

```bash
npm run fiber:setup:receiver
```

Start each node in a separate terminal:

```bash
export FIBER_SECRET_KEY_PASSWORD='your-node-password'
npm run fiber:start:payer
```

```bash
export FIBER_SECRET_KEY_PASSWORD='your-node-password'
npm run fiber:start:receiver
```

Connect/open the local payer-to-receiver channel:

```bash
npm run fiber:connect-local
npm run fiber:open-receiver
```

Check node/channel status:

```bash
npm run fiber:status
```

The payer node must have enough outbound RUSD liquidity for deposits. If a user deposits 10 KES and the channel only has 9 RUSD outbound, M-Pesa can succeed while Fiber settlement becomes `ActionRequired`.

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
| `GET /api/me` | Current user and RUSD balance |
| `GET /api/registry/lookup?phone=...` | Phone-to-Fiber identity lookup |
| `POST /api/fiber/receiver/invoice` | Create receiver-node Fiber invoice |
| `POST /api/mpesa/deposit` | Start M-Pesa STK deposit |
| `POST /api/mpesa/deposits/:id/reconcile` | Query Daraja and retry settlement |
| `POST /api/payments/send-phone` | Send RUSD to another Dular phone |
| `GET /api/transactions` | Unified activity feed |
| `GET /api/verification/deposit/:checkoutRequestId` | Public milestone verification data |
| `POST /api/ussd` | Africa's Talking USSD simulator callback |

## Verification

Milestone verification artifacts are under:

```text
verification/milestone-1/
```

Useful checks:

```bash
curl http://localhost:8787/api/verification/deposit/<CheckoutRequestID>
npm run check:stk-status -- <CheckoutRequestID>
npm run fiber:status
```

The verification endpoint shows:

- M-Pesa checkout/request IDs.
- Deposit status and receipt when available.
- Receiver Fiber invoice.
- Fiber payment hash/status when settlement succeeds.
- Fiber route data when available.

## Troubleshooting

| Problem | Likely Cause | Fix |
| --- | --- | --- |
| Deposit stuck at `Action needed` | M-Pesa succeeded but Fiber settlement could not complete | Add/rebalance outbound RUSD liquidity, then retry settlement |
| `Receiver Fiber invoice payment hash is required` | Old API response shape or stale server | Restart API after pulling latest code |
| Activity missing phone sends | Old API server still running | Restart API so unified feed is active |
| STK accepted but balance not updated | Daraja callback did not reach API | Reconciliation polls STK query; keep app open or call `/reconcile` |
| `Fiber payment ... not found after send timeout` | Fiber node did not record the invoice payment | Check channel liquidity and payer node `list_payments` |
| `Insufficient RUSD balance` | User ledger balance is too low | Deposit or credit test balance before sending/withdrawing |
| SMS not received | Sender ID/route/account issue | Check Africa's Talking dashboard and SMS status |

## Security Notes

- Never commit `.env`.
- Do not put GitHub tokens, Daraja credentials, Africa's Talking keys, or Fiber passwords in Git remotes or source files.
- Fiber node start scripts require `FIBER_SECRET_KEY_PASSWORD` from the shell environment.
- `DEMO_MODE=true` is intended only for local mock development.

## License

MIT

---

Dular: instant stablecoin payments for mobile money markets, no banks, no borders, no middlemen. Just your phone number.
