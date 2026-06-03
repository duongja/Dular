# Milestone 1 Public Testnet Flow

This flow tests the concrete Milestone 1 path without B2C:

1. User verifies phone by OTP.
2. User requests an M-Pesa STK Push deposit.
3. Safaricom confirms payment.
4. Dular pays a separate receiver node's Fiber invoice using public testnet RUSD.
5. Dular credits the in-app ledger only after the Fiber payment succeeds.

## Local Node Topology

- Payer/Dular node RPC: `http://127.0.0.1:8227`
- Receiver node RPC: `http://127.0.0.1:8247`
- Receiver pubkey: get current value with `npm run fiber:status`
- Receiver CKB address: `ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqvwyrvfw03vvkht44nnjetdjmgrss9za4q0fvx8q`

The receiver is intentionally a separate Fiber node. This avoids self-payment and produces a real off-chain Fiber payment record between two nodes.

## Commands

Start processes in separate terminals:

```bash
npm run fiber:setup:receiver
npm run fiber:start:payer
npm run fiber:start:receiver
npm run dev:api
npm run dev -- --host 0.0.0.0
```

Inspect both nodes:

```bash
npm run fiber:status
```

Connect payer and receiver:

```bash
npm run fiber:connect-local
```

Open a RUSD channel from the funded payer node to the receiver:

```bash
npm run fiber:open-receiver
```

If the channel closes with `balance capacity error`, fund the receiver CKB address above with testnet CKB and retry. The receiver needs CKB capacity for its channel reserve even when it contributes `0` RUSD.

Generate a receiver invoice manually:

```bash
npm run fiber:receiver-invoice -- 100000000
```

Pay an invoice manually from the payer node:

```bash
npm run fiber:pay -- fibt1...
```

## Frontend Test

1. Open `http://localhost:5173`.
2. Verify the phone with OTP.
3. In Wallet, enter a KES amount.
4. Click `Generate Testnet Receiver Invoice`.
5. Click `Request STK Push`.
6. Approve the STK Push on the phone.
7. Refresh receipts and check the transaction status.

The transaction should move from `pending` to `mpesa_paid_fiber_pending`, then `completed` after the backend successfully pays the Fiber invoice.

## Evidence Endpoints

Use the checkout request ID from the receipt:

```bash
curl http://localhost:8787/api/verification/deposit/<CheckoutRequestID>
```

The response includes:

- M-Pesa checkout/request IDs and receipt number.
- Receiver Fiber invoice.
- Fiber payment hash.
- Fiber status and route data.
- Ledger credit timestamp.
