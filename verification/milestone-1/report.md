# Dular Milestone 1 Verification Report

Applicant: duongja  
Project: Dular — Mobile Money Stablecoin Wallet on Fiber Network  
Repository: https://github.com/duongja/Dular  
Hosted API: https://dular.vercel.app/api  
Milestone: Milestone 1 — Phone Identity + M-Pesa Ramp  
Report date: June 6, 2026

## Opening Note

Apologies for the delay in submitting this Milestone 1 report. The delay was caused by unavoidable circumstances while finishing the hosted verification API, collecting evidence, and confirming that the public testnet/Fiber evidence was presented clearly. Going forward, I will keep the original reporting cadence stated in the proposal: Thursday reporting, without delays.

## Milestone 1 Scope

Milestone 1 covers:

- Phone number identity registry.
- OTP-based phone verification.
- Public phone-to-Fiber pubkey lookup API.
- M-Pesa STK Push deposit flow using production Daraja credentials.
- RUSD crediting after successful M-Pesa payment and Fiber-backed settlement.
- Public evidence that reviewers can verify without trusting my word.

B2C withdrawal is the only part of the original M-Pesa ramp that is not fully working yet. The blocker is not the Dular application code path; it is access to the correct M-Pesa Org Portal initiator password/security credential. The initiator password setup button was unavailable/blurred on the M-Pesa Org Portal, so I am currently in communication with Safaricom developer relations to resolve the initiator credential issue. I expect this to be sorted out before Milestone 2 reporting.

## Source Code Evidence

The source code is public:

- GitHub repository: https://github.com/duongja/Dular
- Latest implementation/evidence commit before this report: `d7beff1`
- Vercel API deployment support commit: `5e049bb`
- Database-backed registry cleanup commit: `3aad8e9`
- Screenshot evidence commits: `9be2df6`, `d7beff1`

Relevant source files:

- `server/index.js` — Express API routes for OTP, registry lookup, M-Pesa deposit callbacks, transactions, and verification endpoints.
- `server/schema.sql` — PostgreSQL schema for users, OTP requests, sessions, M-Pesa transactions, Fiber payments, callbacks, and ledger entries.
- `server/services/africasTalking.js` — OTP SMS provider integration.
- `server/services/daraja.js` — Safaricom Daraja STK Push, STK query, and B2C request logic.
- `server/services/fiber.js` — Fiber RPC integration.
- `server/services/settlement.js` — Fiber-backed deposit settlement and RUSD ledger crediting.
- `server/seed-registry.js` — reviewer/local seed script for a phone-to-pubkey registry entry.
- `api/index.js` and `vercel.json` — hosted API deployment adapter for Vercel.

## Public Registry API

The public registry API is live on Vercel:

```text
https://dular.vercel.app/api
```

Health check:

```bash
curl https://dular.vercel.app/api/health
```

Example response observed during verification:

```json
{"ok":true,"mode":"production","dbTime":"2026-06-05T20:28:01.317Z"}
```

Phone-to-pubkey lookup:

```bash
curl "https://dular.vercel.app/api/registry/lookup?phone=%2B254718948041"
```

Verified response:

```json
{
  "phone": "+254718948041",
  "fiberPubkey": "0232739a0e4af969db12b003dbcaf90b370ab78355078fc02d81d4d072df3e7087",
  "verifiedAt": "2026-06-03T18:59:56.794Z",
  "lookupProof": {
    "source": "database",
    "publicEndpoint": "https://dular.vercel.app/api/registry/lookup?phone=%2B254718948041"
  }
}
```

Another verified lookup:

```bash
curl "https://dular.vercel.app/api/registry/lookup?phone=%2B254706306515"
```

Verified response:

```json
{
  "phone": "+254706306515",
  "fiberPubkey": "02c963a086524e2da9366a587008f09740675c1cf4d3a29b6404e99d29ac8cc1fe",
  "verifiedAt": "2026-06-05T10:44:50.721Z",
  "lookupProof": {
    "source": "database",
    "publicEndpoint": "https://dular.vercel.app/api/registry/lookup?phone=%2B254706306515"
  }
}
```

404 behavior for unregistered numbers is also live:

```bash
curl "https://dular.vercel.app/api/registry/lookup?phone=%2B254000000000"
```

Expected response:

```json
{"error":"Phone number is not registered"}
```

## Registered Phone Identity Records

The current registry contains the following verified test records:

| Phone | Fiber pubkey | Status |
| --- | --- | --- |
| `+254759778499` | `02c963a086524e2da9366a587008f09740675c1cf4d3a29b6404e99d29ac8cc1fe` | Verified |
| `+254706306515` | `02c963a086524e2da9366a587008f09740675c1cf4d3a29b6404e99d29ac8cc1fe` | Verified |
| `+254718948041` | `0232739a0e4af969db12b003dbcaf90b370ab78355078fc02d81d4d072df3e7087` | Verified |
| `+254700000001` | `0232739a0e4af969db12b003dbcaf90b370ab78355078fc02d81d4d072df3e7087` | Verified reviewer/demo record |
| `+254712345678` | `0232739a0e4af969db12b003dbcaf90b370ab78355078fc02d81d4d072df3e7087` | Verified reviewer/demo record |
| `+254796448347` | `null` | Phone verified, Fiber pubkey not linked yet |

The public lookup endpoint is database-backed. There is no hardcoded/static fallback pubkey in the hosted registry response.

## Registration / OTP Evidence

The OTP registration flow is implemented and tested using Africa's Talking/NEXUSPAY SMS delivery.

Screen recording covering the OTP flow and STK Push:

```text
https://drive.google.com/file/d/1bWI5LG1LBsec0Pui2JF4QTPXNhpnNGU-/view?usp=drive_link
```

GitHub screenshot evidence:

- Original OTP screenshot: `verification/milestone-1/screenshots/raw/otp-delivery-nexuspay-original.jpeg`
- Redacted OTP screenshot: `verification/milestone-1/screenshots/otp-delivery-nexuspay-redacted.jpg`

The screenshot shows NEXUSPAY SMS sender delivering Dular verification codes. The source code path is:

- `POST /api/auth/request-otp` creates an OTP request and sends SMS.
- `POST /api/auth/verify-otp` verifies the code, creates/updates the user, stores `verified_at`, links `fiber_pubkey` where available, creates a session, and initializes a ledger account.

## M-Pesa STK Push Evidence

Production STK Push was tested with real KES payments to NEXUSPAY/Dular. The screen recording above covers the STK Push user flow.

GitHub screenshot evidence:

- Original M-Pesa receipt screenshot: `verification/milestone-1/screenshots/raw/mpesa-stk-nexuspay-original.jpeg`
- Redacted M-Pesa receipt screenshot: `verification/milestone-1/screenshots/mpesa-stk-nexuspay-redacted.jpg`

The M-Pesa screenshot shows KES 1 payments sent to NEXUSPAY LIMITED for Dular account references. The original screenshot is included because the committee may want to verify actual receipt details; the redacted copy is also included for public-safe sharing.

## June 5 Production STK Test Results

The following June 5, 2026 production STK Push tests were recorded in the database. Completed rows are the successful proof rows; failed rows are included for transparency as cancelled/no-response attempts.

| Time UTC | Phone | KES | Status | CheckoutRequestID | Fiber payment hash |
| --- | --- | ---: | --- | --- | --- |
| 2026-06-05 09:58:33 | `+254706306515` | 1.00 | failed | `ws_CO_05062026125835693706306515` | — |
| 2026-06-05 10:02:11 | `+254706306515` | 1.00 | completed | `ws_CO_05062026130221070706306515` | `0xe56221768012b1147e7b13d8a41d41b22ddb8b07ee72f7da107e99ccb8eb274f` |
| 2026-06-05 10:23:27 | `+254706306515` | 1.00 | failed | `ws_CO_05062026132334950706306515` | — |
| 2026-06-05 10:24:39 | `+254706306515` | 1.00 | failed | `ws_CO_05062026132439888706306515` | — |
| 2026-06-05 10:25:07 | `+254706306515` | 2.00 | failed | `ws_CO_05062026132508171706306515` | — |
| 2026-06-05 10:25:36 | `+254706306515` | 100.00 | failed | `ws_CO_05062026132536163706306515` | — |
| 2026-06-05 10:26:11 | `+254706306515` | 1.00 | failed | `ws_CO_05062026132611459706306515` | — |
| 2026-06-05 10:28:38 | `+254706306515` | 1.00 | completed | `ws_CO_05062026132839139706306515` | `0x6119909019626b3765181a62b9f1959c9d70ca896532d90cdb9889785b0b6d15` |
| 2026-06-05 10:45:20 | `+254706306515` | 1.00 | completed | `ws_CO_05062026134521731706306515` | `0x5be88335953f2511b1f40b91ff14ddb99673de16dfc603fd76355689e87a3aa4` |

For the three completed rows, `fiber_status = Success`, `fiber_fee_base_units = 0`, and the RUSD ledger was credited after settlement.

## Public Verification Endpoint for Deposits

A reviewer can inspect deposit proof by CheckoutRequestID:

```bash
curl https://dular.vercel.app/api/verification/deposit/ws_CO_05062026134521731706306515
```

Other completed examples:

```bash
curl https://dular.vercel.app/api/verification/deposit/ws_CO_05062026132839139706306515
curl https://dular.vercel.app/api/verification/deposit/ws_CO_05062026130221070706306515
```

These endpoints return the M-Pesa transaction row, Fiber payment hash, status, amount, timestamps, and linked Fiber payment record where present.

## Fiber / CKB Testnet Evidence

Important distinction: Fiber payment hashes are off-chain payment identifiers. They are not CKB L1 transaction hashes, so they should not be expected to appear as standalone transfers on the CKB explorer. What appears on the CKB explorer are channel lifecycle transactions, especially channel funding cells. The individual RUSD payments occur off-chain inside those channels.

Today’s successful Fiber payment hashes:

```text
0xe56221768012b1147e7b13d8a41d41b22ddb8b07ee72f7da107e99ccb8eb274f
0x6119909019626b3765181a62b9f1959c9d70ca896532d90cdb9889785b0b6d15
0x5be88335953f2511b1f40b91ff14ddb99673de16dfc603fd76355689e87a3aa4
```

Relevant CKB testnet L1 channel funding transactions:

```text
0xcd0f48335321040a477b01cbedd9c5559ab0fc65b743abbe5472edc875bc0154
0xefdb791ac44ba1af435ae2b22f5572862519865990185d3c0d0cd5bd068e9e39
0x6156f3a8f46063d529f74df2a40407fc79ac70322615d2e862875eedf2b6a79c
```

These were checked against CKB testnet RPC and returned committed status:

| CKB tx hash | Status | Block |
| --- | --- | --- |
| `0xcd0f48335321040a477b01cbedd9c5559ab0fc65b743abbe5472edc875bc0154` | committed | `0x145198c` |
| `0xefdb791ac44ba1af435ae2b22f5572862519865990185d3c0d0cd5bd068e9e39` | committed | `0x1409d17` |
| `0x6156f3a8f46063d529f74df2a40407fc79ac70322615d2e862875eedf2b6a79c` | committed | `0x125c4b1` |

Earlier public multi-hop RUSD proof is also included in the repo:

```text
PUBLIC_TESTNET_MULTIHOP_RUSD_PROOF.md
```

Key multi-hop proof:

- Fiber payment hash: `0x20fd6c4a9d9e207420b4f55b4ae095eee9840fca1678afc89f9065298fe4a9e2`
- Route: local nodeA → public node1 → public node2
- Delivered amount: `100000000` base units = 1 RUSD
- Routing fee: `100000` base units = 0.001 RUSD
- Funding tx to public node1: `0xefdb791ac44ba1af435ae2b22f5572862519865990185d3c0d0cd5bd068e9e39`, output `0x0`
- Funding tx to public node2: `0x6156f3a8f46063d529f74df2a40407fc79ac70322615d2e862875eedf2b6a79c`, output `0x0`

The second relay channel funding cell uses Fiber FundingLock and public testnet RUSD type script:

- FundingLock code hash: `0x6c67887fe201ee0c7853f1682c0b77c0e6214044c156c7558269390a8afa6d7c`
- RUSD type script code hash: `0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a`

## B2C Withdrawal Status

B2C withdrawal is not complete yet. The implementation exists in the codebase, but live payout execution is blocked by the M-Pesa Org Portal initiator password/security credential issue.

Current status:

- STK Push deposit path works with production Daraja credentials.
- B2C code path exists in `server/services/daraja.js` and `POST /api/mpesa/withdraw`.
- The required initiator credential could not be completed because the M-Pesa Org Portal initiator password control was unavailable/blurred.
- I have contacted Safaricom developer relations and am working with them to resolve this.
- I expect this to be fixed before Milestone 2 reporting.

## Sandbox / Non-Kenyan Reviewer Fallback

For reviewers without Kenyan M-Pesa access:

- The code can be cloned and run locally.
- `DEMO_MODE=true` can be used for local development/provider mocks.
- `npm run migrate` initializes the PostgreSQL schema.
- `npm run registry:seed -- +254700000001 <actual_fiber_pubkey>` can seed a local registry record.
- `GET /api/registry/lookup?phone=+254700000001` can verify the lookup behavior.
- Safaricom Daraja sandbox credentials can be used against the same integration code path for STK Push simulation.

## Summary

Milestone 1 is substantially complete for phone identity, OTP verification, public registry lookup, production M-Pesa STK Push deposits, and Fiber-backed RUSD crediting evidence.

Completed:

- Public hosted API is live.
- Phone-to-pubkey registry is database-backed and publicly verifiable.
- OTP flow is implemented and evidenced by screen recording and screenshots.
- Production M-Pesa STK Push was tested with real KES payments.
- Successful deposits produced Fiber payment hashes and credited RUSD after settlement.
- Relevant CKB testnet channel funding transactions are listed and committed on-chain.
- Source code and verification artifacts are public in GitHub.

Outstanding:

- B2C withdrawal is blocked by M-Pesa Org Portal initiator password/security credential setup, currently being resolved with Safaricom developer relations.

I will keep the original Thursday reporting schedule from the proposal going forward.
