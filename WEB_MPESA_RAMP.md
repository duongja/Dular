# Web-Only M-Pesa Ramp

This document defines the active Milestone 2 architecture. USSD and the hosted PostgreSQL-balance wallet are not part of this path.

## Trust Model

- The browser owns the Fiber and CKB private keys.
- Dular owns the M-Pesa accounts, KES float, operator RUSD, and routing infrastructure.
- PostgreSQL stores quotes, orders, idempotency keys, provider references, state transitions, and evidence. It does not store a spendable user RUSD balance.
- Production KES is limited by `RAMP_MIN_KES` and `RAMP_MAX_KES`. The delivered asset is explicitly testnet RUSD for the pilot.

## Deposit

```text
quote -> route ready -> browser invoice validated -> STK requested
      -> M-Pesa independently confirmed -> operator pays invoice -> completed
```

Deposit states:

```text
created -> invoice_ready -> mpesa_initiating -> mpesa_pending
        -> mpesa_confirmed -> fiber_sending -> completed

mpesa_initiating|mpesa_pending -> mpesa_unknown|mpesa_failed
mpesa_confirmed|fiber_sending -> delivery_pending -> fiber_sending
created -> quote_expired
```

The API validates invoice currency, exact amount, signed payee pubkey, serialized RUSD type script, order description, payment hash, signature, and expiry. A ready single RUSD channel with enough operator-local balance is required before STK starts.

Callbacks are deduplicated hints. A successful STK callback triggers a Daraja status query; the callback alone cannot authorize RUSD delivery. If the browser is offline after KES receipt, `delivery_pending` remains an explicit operator liability and retries the same invoice hash when the wallet returns.

## Cash-Out

```text
quote -> operator invoice -> browser validates and pays invoice
      -> operator confirms invoice Paid -> B2C -> completed
```

Cash-out states:

```text
awaiting_rusd -> rusd_received -> b2c_submitting -> b2c_pending -> completed
awaiting_rusd -> invoice_expired
b2c_submitting|b2c_pending -> payout_unknown|payout_failed
payout_failed -> refund_pending -> refunded
```

Production cash-out is intentionally disabled in code; the current gate permits only demo or Safaricom sandbox payouts. It must remain disabled until production credentials are operational and the sandbox-only gate is deliberately removed. A failed payout requires an exact browser-signed refund invoice. An unknown payout is never refunded automatically because the KES payout may still complete. An operator may move it to `payout_failed` only through the token-protected adjudication endpoint with an independently verified nonzero provider result code and evidence reference.

## Security Controls

- Railway Fiber RPC requires `FIBER_GATEWAY_RPC_TOKEN`; WSS P2P remains public.
- Arbitrary operator invoice payment and liquidity-seeding endpoints return `410`.
- Route preparation, diagnostics, and channel cleanup use the authenticated account's registered browser pubkey, not a request-body pubkey.
- Browser registration requires a signed Fiber invoice plus a secp256k1 proof whose public key hashes to the submitted CKB funding lock, then binds both keys to one account.
- Ramp creation requires an `Idempotency-Key`; provider IDs and invoice hashes are unique.
- Callback URLs contain a deployment callback token and payloads are hash-deduplicated.
- Non-demo ramp operation also requires a separate operator token. `POST /api/ramp/operator/orders/:id/adjudicate` can attach a lost STK checkout reference for a fresh Daraja query or record independently verified B2C evidence; every decision is written to order state history.
- Legacy managed-wallet and USSD money endpoints are disabled by default.

## Verification

For a completed order:

```bash
curl https://<dular-domain>/api/verification/ramp/<order-id>
```

The response includes redacted phone identity, immutable quote arithmetic, M-Pesa references and receipt, Fiber invoice/payment hashes, timestamps, and state history. Fiber payment hashes are off-chain identifiers. CKB Explorer verifies channel funding outpoints and RUSD FundingLock cells, not individual Fiber payments.

Required milestone evidence:

1. Screen recording of quote, STK approval, browser RUSD balance change, and completed order.
2. Redacted M-Pesa confirmation receipt matching the order.
3. Operator Fiber `get_payment` success and browser invoice/payment hash.
4. Relevant channel funding outpoint on CKB testnet.
5. Redacted `/api/verification/ramp/:id` response.
6. Cash-out demo remains sandbox/demo evidence until production B2C credentials are operational.
