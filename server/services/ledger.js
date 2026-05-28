export async function ensureLedgerAccount(client, userId) {
  await client.query(
    `INSERT INTO ledger_accounts (user_id, balance_base_units)
     VALUES ($1, 0)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  )
}

export async function getBalance(client, userId) {
  const result = await client.query(
    `SELECT balance_base_units FROM ledger_accounts WHERE user_id = $1`,
    [userId],
  )
  return BigInt(result.rows[0]?.balance_base_units || '0')
}

export async function credit(client, { userId, amount, sourceType, sourceId, metadata = {} }) {
  await ensureLedgerAccount(client, userId)
  const inserted = await client.query(
    `INSERT INTO ledger_entries (user_id, direction, amount_base_units, source_type, source_id, metadata)
     VALUES ($1, 'credit', $2, $3, $4, $5)
     ON CONFLICT (source_type, source_id, direction, user_id) DO NOTHING
     RETURNING id`,
    [userId, amount.toString(), sourceType, sourceId, metadata],
  )
  if (inserted.rowCount === 0) return false
  await client.query(
    `UPDATE ledger_accounts
     SET balance_base_units = balance_base_units + $2, updated_at = now()
     WHERE user_id = $1`,
    [userId, amount.toString()],
  )
  return true
}

export async function debit(client, { userId, amount, sourceType, sourceId, metadata = {} }) {
  await ensureLedgerAccount(client, userId)
  const balance = await getBalance(client, userId)
  if (balance < amount) throw new Error('Insufficient RUSD balance')

  const inserted = await client.query(
    `INSERT INTO ledger_entries (user_id, direction, amount_base_units, source_type, source_id, metadata)
     VALUES ($1, 'debit', $2, $3, $4, $5)
     ON CONFLICT (source_type, source_id, direction, user_id) DO NOTHING
     RETURNING id`,
    [userId, amount.toString(), sourceType, sourceId, metadata],
  )
  if (inserted.rowCount === 0) return false
  await client.query(
    `UPDATE ledger_accounts
     SET balance_base_units = balance_base_units - $2, updated_at = now()
     WHERE user_id = $1`,
    [userId, amount.toString()],
  )
  return true
}
