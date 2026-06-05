import { withTransaction } from './db.js'
import { ensureLedgerAccount } from './services/ledger.js'
import { normalizePhone } from './utils.js'

const rawPhone = process.argv[2]
const fiberPubkey = String(process.argv[3] || '').trim()

if (!rawPhone || !fiberPubkey) {
  console.error('Usage: npm run registry:seed -- <phone> <fiber_pubkey>')
  process.exit(1)
}

const phone = normalizePhone(rawPhone)

const user = await withTransaction(async (client) => {
  const result = await client.query(
    `INSERT INTO users (phone, fiber_pubkey, verified_at)
     VALUES ($1, $2, now())
     ON CONFLICT (phone) DO UPDATE
     SET fiber_pubkey = EXCLUDED.fiber_pubkey,
         verified_at = now(),
         updated_at = now()
     RETURNING *`,
    [phone, fiberPubkey],
  )
  await ensureLedgerAccount(client, result.rows[0].id)
  return result.rows[0]
})

console.log(JSON.stringify({
  ok: true,
  phone: user.phone,
  fiberPubkey: user.fiber_pubkey,
  verifiedAt: user.verified_at,
  lookupPath: `/api/registry/lookup?phone=${encodeURIComponent(user.phone)}`,
}, null, 2))
