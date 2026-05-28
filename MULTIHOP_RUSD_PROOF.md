# Multi-hop RUSD Payment Proof

Date: 2026-05-07

This artifact records a successful local 3-node routed XUDT payment on Fiber's dev chain.

## Payment

- Payment hash: `0x0e980cbe0b76eed0d53aa6e1f4febe500500147098fb251e18ee565f7cc12d81`
- Status: `Success`
- Fee: `0x186a0` = `100000`

## Routed path

The payment was sent from Node 1 to Node 3 through Node 2:

1. Node 1 pubkey: `02a64b8993f33b2ebd37a4de1c9441f491291a4e779da8e519bcfb7c1f3f56c9c0`
   Channel outpoint to Node 2:
   `0xe07d47db1ea9bb2ce99576b95be13a019e272ac79f930a637a4eb2baee7b7d4900000000`
   Forwarded amount:
   `0x5f767a0`

2. Node 2 pubkey: `02bcbd0e0d811d13363af1e5998f56e74e6aab8a7aa44005e1ce7d696a4d3f10f6`
   Channel outpoint to Node 3:
   `0x9c3679dfb3ff9e3ebdcfc81a4704d394f5d64c0309f7f3a77548a9489f0c51d600000000`
   Forwarded amount:
   `0x5f5e100`

3. Node 3 pubkey: `03032b99943822e721a651c5a5b9621043017daa9dc3ec81d83215fd2e25121187`
   Received amount:
   `0x5f5e100`

## Channel funding outpoints

- Node1 <-> Node2 channel funding outpoint:
  `0xe07d47db1ea9bb2ce99576b95be13a019e272ac79f930a637a4eb2baee7b7d4900000000`
- Node2 <-> Node3 channel funding outpoint:
  `0x9c3679dfb3ff9e3ebdcfc81a4704d394f5d64c0309f7f3a77548a9489f0c51d600000000`

## Verification note

The Fiber payment hash is an off-chain payment identifier. It is not the same thing as a CKB L1 transaction hash.

What can be verified on-chain are the channel lifecycle transactions, such as the funding/opening outpoints above. The multi-hop payment itself is verified through Fiber RPC payment records, especially the routed hop data returned by `get_payment(payment_hash)`.
