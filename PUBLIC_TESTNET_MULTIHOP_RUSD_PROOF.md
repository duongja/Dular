# Public Testnet Multi-hop RUSD Payment Proof

Date: 2026-05-07

This artifact records a successful public testnet RUSD payment routed from a local node through Fiber public node1 to Fiber public node2.

Route:

`nodeA -> public node1 -> public node2`

## Payment proof

- Payment hash:
  `0x20fd6c4a9d9e207420b4f55b4ae095eee9840fca1678afc89f9065298fe4a9e2`
- Status:
  `Success`
- Fee:
  `0x186a0` = `100000` base units = `0.001 RUSD`

## Routed hops from Fiber payment record

1. Local sender nodeA
   - Pubkey:
     `0232739a0e4af969db12b003dbcaf90b370ab78355078fc02d81d4d072df3e7087`
   - First-hop amount:
     `0x5f767a0`
   - Channel funding tx hash to public node1:
     `0xefdb791ac44ba1af435ae2b22f5572862519865990185d3c0d0cd5bd068e9e39`
   - Output index:
     `0x0`

2. Public node1
   - Pubkey:
     `02b6d4e3ab86a2ca2fad6fae0ecb2e1e559e0b911939872a90abdda6d20302be71`
   - Forwarded amount:
     `0x5f5e100`
   - Channel funding tx hash to public node2:
     `0x6156f3a8f46063d529f74df2a40407fc79ac70322615d2e862875eedf2b6a79c`
   - Output index:
     `0x0`

3. Public node2 / invoice payee
   - Pubkey:
     `0291a6576bd5a94bd74b27080a48340875338fff9f6d6361fe6b8db8d0d1912fcc`
   - Received amount:
     `0x5f5e100` = `100000000` base units = `1 RUSD`

## Invoice proof

- Invoice payee pubkey:
  `0291a6576bd5a94bd74b27080a48340875338fff9f6d6361fe6b8db8d0d1912fcc`
- Invoice payment hash:
  `0x20fd6c4a9d9e207420b4f55b4ae095eee9840fca1678afc89f9065298fe4a9e2`

## Local channel balance change

Before payment, local channel balance on nodeA -> public node1:

- local_balance:
  `0x77359400`
- remote_balance:
  `0x0`

After payment:

- local_balance:
  `0x713e2c60`
- remote_balance:
  `0x5f767a0`

This matches a 1 RUSD payment plus 0.001 RUSD routing fee.

## Explorer / verification note

The Fiber payment hash is an off-chain payment identifier. It is not the same thing as a CKB L1 transaction hash, so readers should not expect the payment hash itself to appear on the CKB explorer.

What can be checked on the CKB testnet explorer are the channel lifecycle transactions and funding outpoints used by the route, including:

- `0xefdb791ac44ba1af435ae2b22f5572862519865990185d3c0d0cd5bd068e9e39` at output index `0x0`
- `0x6156f3a8f46063d529f74df2a40407fc79ac70322615d2e862875eedf2b6a79c` at output index `0x0`

For the second relay channel specifically, output `0x0` of tx `0x6156f3a8f46063d529f74df2a40407fc79ac70322615d2e862875eedf2b6a79c` is a Fiber channel funding cell:

- its lock script uses Fiber's `FundingLock` code hash:
  `0x6c67887fe201ee0c7853f1682c0b77c0e6214044c156c7558269390a8afa6d7c`
- its type script uses the public testnet RUSD code hash:
  `0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a`
- its UDT amount data decodes to `100000000000` base units = `1000 RUSD`

So this is not the off-chain payment itself; it is the on-chain RUSD channel cell that the public relay hop used.

The multi-hop property itself is proven by the Fiber payment record, especially the routed hop list returned by `get_payment(payment_hash)` / `list_payments`.
