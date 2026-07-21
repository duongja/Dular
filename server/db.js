import pg from 'pg'
import { config, requireDatabaseUrl } from './config.js'

const { Pool } = pg

requireDatabaseUrl()

export const pool = new Pool({
  connectionString: config.databaseUrl,
})

export async function query(text, params = []) {
  return pool.query(text, params)
}

export async function withTransaction(callback) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function withAdvisoryLock(key, callback) {
  const client = await pool.connect()
  let locked = false
  try {
    const result = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [key])
    locked = result.rows[0]?.locked === true
    if (!locked) throw new Error('Another operator route is being prepared. Retry shortly.')
    return await callback(client)
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key])
    } finally {
      client.release()
    }
  }
}
