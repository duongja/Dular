import { query } from './db.js'
import { hashValue } from './utils.js'

export async function requireAuth(req, res, next) {
  try {
    const header = req.get('authorization') || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) return res.status(401).json({ error: 'Authentication required' })

    const result = await query(
      `SELECT u.*, la.balance_base_units
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN ledger_accounts la ON la.user_id = u.id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hashValue(token)],
    )
    if (!result.rows[0]) return res.status(401).json({ error: 'Invalid or expired session' })
    req.user = result.rows[0]
    req.token = token
    next()
  } catch (error) {
    next(error)
  }
}
