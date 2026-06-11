# Dular Usage Report

We have been using the support to build and verify Dular, a mobile-money-first stablecoin wallet on CKB Fiber Network. The work so far has focused on turning the original concept into a working product prototype with real integrations, public verification artifacts, and testable payment flows.

Dular now has a working web wallet where users can register with a Kenyan phone number, verify by OTP, receive a mapped Fiber pubkey, deposit through M-Pesa STK Push, hold RUSD balances, and send RUSD to another Dular user by phone number. The phone-number identity layer is backed by a PostgreSQL database and exposed through a public registry lookup API, so reviewers can verify that a phone number maps to a registered Fiber identity instead of relying only on screenshots or private claims.

We also integrated Safaricom Daraja for production M-Pesa STK Push deposits. Real KES deposit attempts were tested, recorded, and connected to the Dular ledger. The system tracks deposit status, M-Pesa checkout IDs, receipts, Fiber payment hashes where available, and transaction history. We also documented the current B2C withdrawal blocker clearly: the code path exists, but live withdrawal execution is pending Safaricom initiator/security credential activation.

On the CKB/Fiber side, we built and tested a Fiber-backed RUSD flow using public testnet infrastructure. The project includes proof of a public testnet multi-hop RUSD payment, with Fiber payment hash, route participants, hop pubkeys, amount, fee, and related CKB testnet channel funding transactions. We also added explanation for reviewers that Fiber payment hashes are off-chain identifiers, while CKB Explorer verifies the on-chain channel funding and settlement cells.

For the second phase of the product, we built a USSD interface for feature-phone users through Africa's Talking. The backend now supports a USSD callback endpoint with menu flows for checking balance, sending RUSD, receiving identity details, starting M-Pesa deposit requests, setting a USSD PIN, and showing the withdrawal status. We tested this through the Africa's Talking simulator using real session flows and included the exported session records as verification evidence.

The work has produced code, working API endpoints, real test records, GitHub commits, and verification files that can be independently reviewed. The support has helped us move faster across product design, backend implementation, frontend UX improvements, debugging live integration issues, generating verification documentation, preparing proposal responses, and structuring evidence for public review.

Repository: https://github.com/duongja/Dular
