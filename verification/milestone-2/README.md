# Dular Milestone 2 Verification: USSD Simulator

Milestone 2 adds the USSD interface promised in the proposal. This implementation is simulator-first because the paid shared shortcode is not active yet. The same callback is ready for Africa's Talking once the live code is assigned.

## Public Callback

Use this callback URL in the Africa's Talking USSD simulator:

```text
https://dular.vercel.app/api/ussd
```

The endpoint accepts Africa's Talking form fields:

```text
sessionId
serviceCode
phoneNumber
text
networkCode
```

It returns plain text using the USSD response format:

```text
CON message
END message
```

## Menu

```text
Welcome to Dular
1. Check balance
2. Send RUSD
3. Receive RUSD
4. Deposit from M-Pesa
5. Withdraw to M-Pesa
6. Set or change PIN
```

## What Reviewers Can Test

- Check balance for a registered Dular phone.
- Set or change a 4-digit USSD PIN.
- Send RUSD from one registered Dular phone to another registered Dular phone.
- Receive RUSD identity details, including the public registry lookup URL.
- Start an M-Pesa STK Push deposit request from USSD.
- Confirm the withdrawal path is present but disabled pending Safaricom B2C credential activation.

## Africa's Talking Session Export

The simulator session export downloaded from Africa's Talking is included here:

- [`ussd-sessions-africas-talking-2026-06-11.csv`](./ussd-sessions-africas-talking-2026-06-11.csv)

The export contains 20 simulator sessions from June 11, 2026 for service code `*384*81618#`, using the registered test phones `+254718948041` and `+254796448347`. The rows include Africa's Talking session IDs, hop counts, durations, and final statuses, providing independent evidence that the simulator reached the Dular USSD callback and completed multiple menu flows.

## Simulator Test Script

Use a phone already registered in the Dular database, for example:

```text
+254718948041
```

Open the Africa's Talking simulator, select USSD, set the callback URL to `https://dular.vercel.app/api/ussd`, and start a session.

### 1. Main Menu

Input:

```text
text=
```

Expected:

```text
CON Welcome to Dular
1. Check balance
2. Send RUSD
3. Receive RUSD
4. Deposit from M-Pesa
5. Withdraw to M-Pesa
6. Set or change PIN
```

### 2. Balance

Input:

```text
text=1
```

Expected:

```text
END Your Dular balance is <amount> RUSD.
```

### 3. Set PIN

Inputs:

```text
text=6
text=6*1234
text=6*1234*1234
```

Expected final response:

```text
END Your Dular USSD PIN has been set. You can now send RUSD from USSD.
```

### 4. Send RUSD

Inputs:

```text
text=2
text=2*+254706306515
text=2*+254706306515*1
text=2*+254706306515*1*1234
```

Expected final response:

```text
END Sent 1 RUSD to +254706306515. Ref: <reference>
```

The same transfer appears in the existing web activity feed because USSD reuses the `phone_payment` ledger entries used by the web app.

### 5. Receive Details

Input:

```text
text=3
```

Expected:

```text
END Receive RUSD with +254718948041.
Fiber pubkey: <registered pubkey>
Registry proof: https://dular.vercel.app/api/registry/lookup?phone=%2B254718948041
```

### 6. Deposit Request

Inputs:

```text
text=4
text=4*10
```

Expected final response:

```text
END M-Pesa prompt sent for KES 10. Approve it on your phone. Checkout: <CheckoutRequestID>
```

The STK request uses the same Daraja integration as the web deposit flow. Fiber-backed settlement continues through the existing backend deposit pipeline when invoice/liquidity configuration is available.

### 7. Withdrawal Placeholder

Input:

```text
text=5
```

Expected:

```text
END Withdrawals are temporarily pending Safaricom B2C credential activation. Deposits, balance, and sends are available.
```

## Local Curl Checks

```bash
curl -s -X POST http://localhost:8787/api/ussd \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "sessionId=test-001&serviceCode=*483*XXXX%23&phoneNumber=%2B254718948041&text="
```

```bash
curl -s -X POST http://localhost:8787/api/ussd \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "sessionId=test-002&serviceCode=*483*XXXX%23&phoneNumber=%2B254718948041&text=1"
```

## Evidence Stored by the Backend

The backend records simulator sessions in:

- `ussd_sessions`: latest state for each simulator session.
- `ussd_pins`: hashed USSD PIN per phone number.
- `ussd_logs`: every request and response for transcript evidence.

These records allow the Milestone 2 report to include a timestamped simulator transcript without relying only on screenshots.

## Current Limitation

B2C withdrawal execution is intentionally disabled in this Milestone 2 simulator build. The Dular code path for B2C exists, but live execution depends on Safaricom Org Portal initiator/security credential activation. The USSD withdraw menu is included to show the full user flow and returns a clear status message instead of attempting a payout.
