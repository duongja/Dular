# Milestone 1 Verification

This folder documents the Phone Identity + M-Pesa ramp implementation.

## Local Setup

1. Create `.env` from `.env.example`.
2. Set `DATABASE_URL` to a PostgreSQL database.
3. Run `npm run migrate`.
4. Start the API with `npm run dev:api`.
5. Start the web app with `npm run dev -- --host 0.0.0.0`.

For local development, keep `DEMO_MODE=true`. OTP responses include `demoCode: "123456"` and M-Pesa provider calls return pending demo transaction IDs.

## Reviewer Checks

- `POST /api/auth/request-otp` sends an OTP to a Kenyan phone number.
- `POST /api/auth/verify-otp` creates a verified phone registry record and session.
- `GET /api/registry/lookup?phone=+254700000001` returns the verified phone mapping or `404`.
- `POST /api/mpesa/deposit` starts an STK Push and records a pending deposit.
- `POST /api/mpesa/callback/stk` completes a deposit and credits the RUSD ledger.
- `POST /api/mpesa/withdraw` starts a B2C withdrawal and debits the ledger.
- `POST /api/payments/send-phone` sends RUSD between verified local phone identities.

## Public API

The hosted reviewer API is:

```text
https://dular.vercel.app/api
```

Useful public checks:

```bash
curl https://dular.vercel.app/api/health
curl "https://dular.vercel.app/api/registry/lookup?phone=%2B254718948041"
```

The registry lookup response is database-backed and includes the registered phone, Fiber pubkey, verification timestamp, and the public proof URL.

## Screenshot Evidence

Sanitized screenshots are stored in [`screenshots/`](./screenshots/). They are intentionally redacted before being committed to the public repo.

| File | What it shows | Redactions |
| --- | --- | --- |
| [`otp-delivery-nexuspay-redacted.jpg`](./screenshots/otp-delivery-nexuspay-redacted.jpg) | Africa's Talking/NEXUSPAY SMS sender delivering Dular OTP messages for phone verification. | OTP values are redacted because they are authentication secrets. |
| [`mpesa-stk-nexuspay-redacted.jpg`](./screenshots/mpesa-stk-nexuspay-redacted.jpg) | Live M-Pesa confirmation messages for KES 1 payments sent to NEXUSPAY/Dular. | Transaction IDs, full Dular account reference, balances, daily limits, URLs, and Fuliza details are redacted. |

## Evidence To Attach At Milestone Submission

- Screen recording of OTP registration and registry lookup.
- Redacted STK Push receipt and matching API transaction response.
- Redacted B2C receipt and matching API transaction response.
- Ledger transaction export for deposit, send-to-phone, and withdrawal.
- Relevant Fiber node/channel proof for managed liquidity.
