import fs from 'node:fs/promises'
import { pool } from './db.js'

const sql = await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8')

try {
  await pool.query(sql)
  console.log('Database schema is ready')
} finally {
  await pool.end()
}
