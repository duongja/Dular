import express from 'express'
import cors from 'cors'
import crypto from 'node:crypto'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import { WebSocketServer } from 'ws'
import { config } from './config.js'
import { query, withTransaction } from './db.js'
import { requireAuth } from './auth.js'
import { sendOtpSms } from './services/africasTalking.js'
import { initiateB2c, initiateStkPush, queryStkPushStatus } from './services/daraja.js'
import {
  abandonFiberChannel,
  createReceiverInvoice,
  getNodeInfo,
  getNodePubkey,
  getReceiverNodeInfo,
  listChannelsByPeer,
  listFiberPeers,
  openFundedRUsdChannel,
  parseFiberInvoice,
  RUSD_TYPE_SCRIPT,
  sendFiberPayment,
  updateFiberChannel,
} from './services/fiber.js'
import { credit, debit, ensureLedgerAccount } from './services/ledger.js'
import { createFiberBackedDepositSettlement } from './services/settlement.js'
import { handleUssdRequest } from './services/ussd.js'
import {
  asyncHandler,
  createOtp,
  createToken,
  hashOtp,
  hashValue,
  normalizePhone,
  parseBaseUnits,
  publicUser,
  toRUsdBaseUnits,
} from './utils.js'

const app = express()
const execFileAsync = promisify(execFile)
const CKB_TESTNET_RPC_URL = process.env.CKB_TESTNET_RPC_URL || 'https://testnet.ckbapp.dev/'
const CKB_SECP256K1_BLAKE160_CODE_HASH = '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8'
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const BECH32M_CONST = 0x2bc830a3

app.use(cors())
app.use((_req, res, next) => {
  // Fiber WASM requires SharedArrayBuffer, which needs cross-origin isolation.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
  next()
})
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: false }))

function readStkReceipt(payload) {
  const items = payload?.Body?.stkCallback?.CallbackMetadata?.Item
    || payload?.stkCallback?.CallbackMetadata?.Item
    || payload?.CallbackMetadata?.Item
    || []
  return items.find((item) => item.Name === 'MpesaReceiptNumber')?.Value || payload?.MpesaReceiptNumber || null
}

function readResultCode(payload) {
  if (payload?.ResultCode === undefined || payload?.ResultCode === null) return null
  const resultCode = Number(payload.ResultCode)
  return Number.isFinite(resultCode) ? resultCode : null
}

function mergePayload(key, payload) {
  return JSON.stringify({
    [key]: payload,
    [`${key}At`]: new Date().toISOString(),
  })
}

function publicApiUrl(pathname) {
  const base = config.publicBaseUrl.replace(/\/+$/, '')
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`
  return `${base}${path}`
}

function browserPeerMultiaddr(req) {
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost'
  const hostname = host.split(':')[0]
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
  return `${isIpv4 ? `/ip4/${hostname}` : `/dns4/${hostname}`}/tcp/${config.port}/ws`
}

function channelStateName(channel) {
  return channel?.state?.state_name || channel?.state_name || ''
}

function channelLocalBalance(channel) {
  return BigInt(channel?.local_balance || channel?.localBalance || '0x0')
}

function channelFeeRate(channel) {
  return BigInt(channel?.tlc_fee_proportional_millionths || '0x0')
}

function isZeroFeeChannel(channel) {
  return channelFeeRate(channel) === 0n
}

function isPublicChannel(channel) {
  return channel?.is_public === true || channel?.public === true
}

function readyRoutableBrowserChannels(channels) {
  return (channels || [])
    .filter((channel) => channelStateName(channel) === 'ChannelReady')
    .filter(isZeroFeeChannel)
    .filter(isPublicChannel)
}

function invoiceAttrValue(invoice, snakeKey, camelKey) {
  const attrs = invoice?.data?.attrs || []
  for (const attr of attrs) {
    if (Object.prototype.hasOwnProperty.call(attr, snakeKey)) return attr[snakeKey]
    if (Object.prototype.hasOwnProperty.call(attr, camelKey)) return attr[camelKey]
  }
  return null
}

function invoicePayeePubkey(parsed) {
  return String(invoiceAttrValue(parsed?.invoice, 'payee_public_key', 'PayeePublicKey') || '').trim().toLowerCase()
}

function invoiceAmount(parsed) {
  return BigInt(parsed?.invoice?.amount || '0x0')
}

function invoiceAllowsHopHints(parsed) {
  const attrs = parsed?.invoice?.data?.attrs || []
  return attrs.some((attr) => {
    const feature = attr.feature || attr.Feature
    if (!feature) return false
    const values = Array.isArray(feature) ? feature : [feature]
    return values.some((value) => String(value).includes('TRAMPOLINE_ROUTING'))
  })
}

function hopHintForChannel(operatorPubkey, channel) {
  if (!channel?.channel_outpoint) return null
  return {
    pubkey: operatorPubkey,
    channel_outpoint: channel.channel_outpoint,
    fee_rate: channel.tlc_fee_proportional_millionths || '0x0',
    tlc_expiry_delta: channel.tlc_expiry_delta || '0xdbba00',
  }
}

function forwardingFeeBaseUnits(amountBaseUnits, channel) {
  const feeRate = channelFeeRate(channel)
  if (feeRate === 0n) return 0n
  return (amountBaseUnits * feeRate) / 1_000_000n
}

async function ensureZeroFeeBrowserRoute(channel) {
  if (!channel) return channel
  if (channel.tlc_fee_proportional_millionths !== '0x0') {
    try {
      await updateFiberChannel({
        channelId: channel.channel_id,
        tlcFeeProportionalMillionths: '0x0',
      })
    } catch {
      return channel
    }
  }
  return {
    ...channel,
    tlc_fee_proportional_millionths: '0x0',
  }
}

async function waitForOutboundLiquidity(pubkey, requiredAmount, { timeoutMs = 30000, pollMs = 2000, requireZeroFee = true } = {}) {
  const start = Date.now()
  let latest = { channels: [] }
  while (Date.now() - start < timeoutMs) {
    latest = await listChannelsByPeer(pubkey)
    const readyChannels = requireZeroFee
      ? readyRoutableBrowserChannels(latest.channels || [])
      : (latest.channels || []).filter((channel) => channelStateName(channel) === 'ChannelReady')
    const outboundLiquidity = readyChannels.reduce((total, channel) => total + channelLocalBalance(channel), 0n)
    const ready = readyChannels.find((channel) => channelLocalBalance(channel) >= requiredAmount) || readyChannels[0] || null
    if (outboundLiquidity >= requiredAmount) {
      return { ready, readyChannels, outboundLiquidity, channels: latest.channels || [] }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  const readyChannels = requireZeroFee
    ? readyRoutableBrowserChannels(latest.channels || [])
    : (latest.channels || []).filter((channel) => channelStateName(channel) === 'ChannelReady')
  const outboundLiquidity = readyChannels.reduce((total, channel) => total + channelLocalBalance(channel), 0n)
  return {
    ready: null,
    readyChannels,
    outboundLiquidity,
    channels: latest.channels || [],
  }
}

async function prepareBrowserOutboundChannel({ pubkey, fundingAmountBaseUnits, replacePending = false }) {
  const peers = await listFiberPeers()
  const connectedPeer = peers.peers?.find((peer) => peer.pubkey.toLowerCase() === pubkey)
  if (!connectedPeer) {
    throw new Error('Browser wallet is not connected to the Dular operator node yet. Keep the receiver wallet open and refresh network.')
  }

  let existing = await listChannelsByPeer(pubkey)
  let readyChannels = readyRoutableBrowserChannels(existing.channels || [])
  let outboundLiquidity = readyChannels.reduce((total, channel) => total + channelLocalBalance(channel), 0n)
  let pendingChannels = (existing.channels || []).filter((channel) => channelStateName(channel) !== 'ChannelReady')
  let existingPending = pendingChannels[0] || null
  let readyChannel = outboundLiquidity >= fundingAmountBaseUnits
    ? readyChannels.find((channel) => channelLocalBalance(channel) >= fundingAmountBaseUnits) || readyChannels[0] || null
    : null
  let fundingStatus = null

  const abandonedPendingChannels = []
  const shouldClearPending = outboundLiquidity < fundingAmountBaseUnits
    && pendingChannels.length
    && (replacePending || stalePendingChannels(pendingChannels).length === pendingChannels.length)

  if (outboundLiquidity < fundingAmountBaseUnits && pendingChannels.length) {
    fundingStatus = await operatorFundingStatus(fundingAmountBaseUnits)
    if (!fundingStatus.hasEnoughRUsd) {
      return {
        connectedPeer,
        abandonedPendingChannels,
        channelBootstrap: null,
        pendingChannel: existingPending,
        pendingChannels,
        readyChannel: null,
        outboundLiquidity,
        requiredOutboundLiquidity: fundingAmountBaseUnits,
        operatorFundingAddress: fundingStatus.fundingAddress,
        operatorOnChainRUsd: fundingStatus.onChainRUsd,
        nextAction: 'fund_operator_rusd',
      }
    }
  }

  if (shouldClearPending) {
    for (const channel of pendingChannels) {
      await abandonFiberChannel(channel.channel_id)
      abandonedPendingChannels.push(channel.channel_id)
    }
    existing = await listChannelsByPeer(pubkey)
    readyChannels = readyRoutableBrowserChannels(existing.channels || [])
    outboundLiquidity = readyChannels.reduce((total, channel) => total + channelLocalBalance(channel), 0n)
    pendingChannels = (existing.channels || []).filter((channel) => channelStateName(channel) !== 'ChannelReady')
    existingPending = pendingChannels[0] || null
    readyChannel = outboundLiquidity >= fundingAmountBaseUnits
      ? readyChannels.find((channel) => channelLocalBalance(channel) >= fundingAmountBaseUnits) || readyChannels[0] || null
      : null
  }

  let channelBootstrap = null
  if (!readyChannel && !existingPending) {
    fundingStatus ||= await operatorFundingStatus(fundingAmountBaseUnits)
    if (!fundingStatus.hasEnoughRUsd) {
      return {
        connectedPeer,
        abandonedPendingChannels,
        channelBootstrap: null,
        pendingChannel: null,
        pendingChannels: [],
        readyChannel: null,
        outboundLiquidity,
        requiredOutboundLiquidity: fundingAmountBaseUnits,
        operatorFundingAddress: fundingStatus.fundingAddress,
        operatorOnChainRUsd: fundingStatus.onChainRUsd,
        nextAction: 'fund_operator_rusd',
      }
    }
    channelBootstrap = await openFundedRUsdChannel({
      pubkey,
      fundingAmountBaseUnits,
      isPublic: true,
    })
  }

  if (!readyChannel) {
    const waited = await waitForOutboundLiquidity(pubkey, fundingAmountBaseUnits, { timeoutMs: 30000, pollMs: 2000, requireZeroFee: true })
    readyChannel = waited.ready
    outboundLiquidity = waited.outboundLiquidity
    pendingChannels = (waited.channels || []).filter((channel) => channelStateName(channel) !== 'ChannelReady')
    existingPending = pendingChannels[0] || null
  }

  readyChannel = await ensureZeroFeeBrowserRoute(readyChannel)

  return {
    connectedPeer,
    abandonedPendingChannels,
    channelBootstrap,
    pendingChannel: existingPending || null,
    pendingChannels,
    readyChannel,
    outboundLiquidity,
    requiredOutboundLiquidity: fundingAmountBaseUnits,
    operatorFundingAddress: fundingStatus?.fundingAddress || '',
    operatorOnChainRUsd: fundingStatus?.onChainRUsd || null,
    nextAction: readyChannel ? null : (channelBootstrap || existingPending ? 'accept_channel' : 'wait_for_channel_ready'),
  }
}

function bech32Polymod(values) {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let checksum = 1
  for (const value of values) {
    const top = checksum >> 25
    checksum = ((checksum & 0x1ffffff) << 5) ^ value
    for (let index = 0; index < generators.length; index += 1) {
      if ((top >> index) & 1) checksum ^= generators[index]
    }
  }
  return checksum >>> 0
}

function bech32HrpExpand(hrp) {
  const expanded = []
  for (const char of hrp) expanded.push(char.charCodeAt(0) >> 5)
  expanded.push(0)
  for (const char of hrp) expanded.push(char.charCodeAt(0) & 31)
  return expanded
}

function bytesToBase32(bytes) {
  const values = []
  let accumulator = 0
  let bits = 0
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      values.push((accumulator >> bits) & 31)
    }
  }
  if (bits > 0) values.push((accumulator << (5 - bits)) & 31)
  return values
}

function bech32mEncode(hrp, bytes) {
  const data = bytesToBase32(bytes)
  const checksumInput = [...bech32HrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]
  const polymod = bech32Polymod(checksumInput) ^ BECH32M_CONST
  const checksum = []
  for (let index = 0; index < 6; index += 1) {
    checksum.push((polymod >> (5 * (5 - index))) & 31)
  }
  return `${hrp}1${[...data, ...checksum].map((value) => BECH32_CHARSET[value]).join('')}`
}

function lockArgToAddress(lockArg) {
  const codeHash = Buffer.from(CKB_SECP256K1_BLAKE160_CODE_HASH.slice(2), 'hex')
  const args = Buffer.from(lockArg.slice(2), 'hex')
  // CKB2021 full address payload: 0x00 + code_hash + hash_type(type=0x01) + args.
  return bech32mEncode('ckt', Buffer.concat([Buffer.from([0]), codeHash, Buffer.from([1]), args]))
}

async function ckbRpc(method, params) {
  const response = await fetch(CKB_TESTNET_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!response.ok) {
    throw new Error(`CKB RPC returned HTTP ${response.status}`)
  }
  const payload = await response.json()
  if (payload.error) {
    throw new Error(payload.error.message || `CKB RPC ${method} failed`)
  }
  return payload.result
}

function formatCapacity(capacityShannons) {
  const whole = capacityShannons / 100_000_000n
  const fractional = capacityShannons % 100_000_000n
  if (fractional === 0n) return `${whole}.0 (CKB)`
  return `${whole}.${fractional.toString().padStart(8, '0').replace(/0+$/, '')} (CKB)`
}

function udtAmountFromData(data) {
  const hexData = String(data || '0x').slice(2).padEnd(32, '0').slice(0, 32)
  let amount = 0n
  for (let index = 0; index < 16; index += 1) {
    amount += BigInt(Number.parseInt(hexData.slice(index * 2, index * 2 + 2) || '0', 16)) << BigInt(index * 8)
  }
  return amount
}

async function cellsByLockArg(lockArg, filter = undefined) {
  const searchKey = {
    script: {
      code_hash: CKB_SECP256K1_BLAKE160_CODE_HASH,
      hash_type: 'type',
      args: lockArg,
    },
    script_type: 'lock',
    ...(filter ? { filter } : {}),
  }
  let cursor = null
  const cells = []

  do {
    const params = cursor
      ? [searchKey, 'asc', '0x64', cursor]
      : [searchKey, 'asc', '0x64']
    const result = await ckbRpc('get_cells', params)
    cells.push(...(result.objects || []))
    cursor = result.last_cursor && result.last_cursor !== '0x' ? result.last_cursor : null
  } while (cursor)

  return cells
}

async function capacityByLockArg(lockArg) {
  const cells = await cellsByLockArg(lockArg)
  const total = cells.reduce((sum, cell) => sum + BigInt(cell.output?.capacity || '0x0'), 0n)
  return formatCapacity(total)
}

async function udtAmountByLockArg(lockArg, typeScript) {
  const cells = await cellsByLockArg(lockArg, { script: typeScript })
  return cells.reduce((sum, cell) => sum + udtAmountFromData(cell.output_data), 0n)
}

function channelCreatedAtMs(channel) {
  const raw = channel?.created_at || channel?.createdAt
  if (!raw) return 0
  try {
    return Number(BigInt(raw))
  } catch {
    return 0
  }
}

function stalePendingChannels(channels, maxAgeMs = 90_000) {
  const now = Date.now()
  return channels.filter((channel) => {
    const createdAt = channelCreatedAtMs(channel)
    return createdAt > 0 && now - createdAt > maxAgeMs
  })
}

async function operatorFundingStatus(fundingAmountBaseUnits) {
  const operator = await getNodeInfo()
  const fundingLockArg = operator.default_funding_lock_script?.args || ''
  const fundingAddress = fundingLockArg ? lockArgToAddress(fundingLockArg) : ''
  const onChainRUsd = fundingLockArg ? await udtAmountByLockArg(fundingLockArg, RUSD_TYPE_SCRIPT) : 0n
  return {
    fundingLockArg,
    fundingAddress,
    onChainRUsd,
    hasEnoughRUsd: onChainRUsd >= fundingAmountBaseUnits,
  }
}

async function transferDevCapacity(address, capacityCkb) {
  const password = process.env.FIBER_SECRET_KEY_PASSWORD
  if (!password) {
    throw new Error('FIBER_SECRET_KEY_PASSWORD is required for dev wallet funding')
  }

  const encryptedKey = await fs.readFile(path.resolve('.fiber-node-fresh/ckb/key'))
  const salt = encryptedKey.subarray(1, 17)
  const nonce = encryptedKey.subarray(17, 29)
  const ciphertext = encryptedKey.subarray(29)

  const derivedKey = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 32, {
      N: 1 << 17,
      r: 8,
      p: 1,
      maxmem: 256 * 1024 * 1024,
    }, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })

  const authTag = ciphertext.subarray(ciphertext.length - 16)
  const payload = ciphertext.subarray(0, ciphertext.length - 16)
  const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, nonce)
  decipher.setAuthTag(authTag)
  const plaintextKey = Buffer.concat([decipher.update(payload), decipher.final()]).toString('hex')

  const tempKeyPath = path.join(os.tmpdir(), `dular-funding-${Date.now()}.key`)
  await fs.writeFile(tempKeyPath, `${plaintextKey}\n`, { mode: 0o600 })

  try {
    const { stdout } = await execFileAsync('ckb-cli', [
      '--url',
      'https://testnet.ckbapp.dev/',
      'wallet',
      'transfer',
      '--privkey-path',
      tempKeyPath,
      '--to-address',
      address,
      '--capacity',
      String(capacityCkb),
      '--output-format',
      'json',
    ], { timeout: 60_000 })

    return JSON.parse(stdout)
  } finally {
    await fs.rm(tempKeyPath, { force: true })
  }
}

async function settlePaidDeposit(client, tx, { receipt, checkoutRequestId, providerPayload, providerKey = 'stkResult' }) {
  const updated = await client.query(
    `UPDATE mpesa_transactions
     SET status = 'mpesa_paid_fiber_pending',
         receipt_number = COALESCE($2, receipt_number),
         provider_payload = COALESCE(provider_payload, '{}'::jsonb) || $3::jsonb,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [tx.id, receipt || null, mergePayload(providerKey, providerPayload)],
  )

  try {
    await createFiberBackedDepositSettlement(client, updated.rows[0], {
      receipt: receipt || updated.rows[0].receipt_number,
      checkoutRequestId,
    })
  } catch (error) {
    console.error('Fiber deposit settlement failed', error)
    await client.query(
      `UPDATE mpesa_transactions
       SET status = 'mpesa_paid_fiber_pending',
           fiber_status = 'ActionRequired',
           provider_payload = COALESCE(provider_payload, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [tx.id, mergePayload('fiberSettlementError', { message: error.message })],
    )
  }

  const latest = await client.query('SELECT * FROM mpesa_transactions WHERE id = $1', [tx.id])
  return latest.rows[0]
}

async function applyStkResult(client, tx, payload, providerKey) {
  const resultCode = readResultCode(payload)
  const receipt = readStkReceipt(payload)
  if (resultCode === 0) {
    return settlePaidDeposit(client, tx, {
      receipt,
      checkoutRequestId: tx.checkout_request_id || payload?.CheckoutRequestID,
      providerPayload: payload,
      providerKey,
    })
  }

  if (resultCode === null) {
    const updated = await client.query(
      `UPDATE mpesa_transactions
       SET provider_payload = COALESCE(provider_payload, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [tx.id, mergePayload(providerKey, payload)],
    )
    return updated.rows[0]
  }

  const updated = await client.query(
    `UPDATE mpesa_transactions
     SET status = 'failed',
         provider_payload = COALESCE(provider_payload, '{}'::jsonb) || $2::jsonb,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [tx.id, mergePayload(providerKey, payload)],
  )
  return updated.rows[0]
}

app.get('/api/health', asyncHandler(async (_req, res) => {
  const db = await query('SELECT now() AS now')
  res.json({ ok: true, mode: config.demoMode ? 'demo' : 'production', dbTime: db.rows[0].now })
}))

app.get('/api', (_req, res) => {
  res.json({
    name: 'Dular Milestone 1 API',
    status: 'online',
    endpoints: {
      health: '/api/health',
      registryLookup: '/api/registry/lookup?phone=+254700000001',
      ussd: '/api/ussd',
      registerDevice: '/api/fiber/register-device',
      verificationDeposit: '/api/verification/deposit/:checkoutRequestId',
    },
  })
})

app.post('/api/ussd', asyncHandler(async (req, res) => {
  const response = await handleUssdRequest(req.body, req)
  res.type('text/plain').send(response)
}))

app.post('/api/auth/request-otp', asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone)
  const code = createOtp()
  const codeHash = hashOtp(phone, code)
  await query(
    `INSERT INTO otp_requests (phone, code_hash, expires_at)
     VALUES ($1, $2, now() + interval '10 minutes')`,
    [phone, codeHash],
  )
  const sms = await sendOtpSms(phone, code)
  res.json({
    ok: true,
    phone,
    expiresInSeconds: 600,
    demoCode: config.otpDemoMode ? sms.code : undefined,
  })
}))

app.post('/api/auth/verify-otp', asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone)
  const code = String(req.body.code || '').trim()
  if (!/^\d{6}$/.test(code)) throw new Error('Enter the 6 digit verification code')

  const result = await withTransaction(async (client) => {
    const otp = await client.query(
      `SELECT * FROM otp_requests
       WHERE phone = $1 AND consumed_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [phone],
    )
    const row = otp.rows[0]
    if (!row) throw new Error('No active OTP. Request a new code.')
    if (row.attempts >= 5) throw new Error('Too many OTP attempts. Request a new code.')

    await client.query('UPDATE otp_requests SET attempts = attempts + 1 WHERE id = $1', [row.id])
    if (row.code_hash !== hashOtp(phone, code)) throw new Error('Invalid verification code')
    await client.query('UPDATE otp_requests SET consumed_at = now() WHERE id = $1', [row.id])

    let fiberPubkey = null
    if (config.fiberRpcConfigured) {
      try {
        fiberPubkey = await getNodePubkey()
      } catch {
        fiberPubkey = null
      }
    }

    const user = await client.query(
      `INSERT INTO users (phone, fiber_pubkey, verified_at)
       VALUES ($1, $2, now())
       ON CONFLICT (phone) DO UPDATE
       SET verified_at = now(),
           fiber_pubkey = COALESCE(EXCLUDED.fiber_pubkey, users.fiber_pubkey),
           updated_at = now()
       RETURNING *`,
      [phone, fiberPubkey],
    )
    await ensureLedgerAccount(client, user.rows[0].id)

    const token = createToken()
    await client.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, now() + interval '14 days')`,
      [hashValue(token), user.rows[0].id],
    )

    const account = await client.query(
      'SELECT balance_base_units FROM ledger_accounts WHERE user_id = $1',
      [user.rows[0].id],
    )
    return { token, user: publicUser(user.rows[0], account.rows[0]?.balance_base_units || '0') }
  })

  res.json(result)
}))

app.get('/api/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: publicUser(req.user, req.user.balance_base_units || '0') })
}))

app.get('/api/registry/lookup', asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.query.phone)
  const result = await query(
    `SELECT phone, fiber_pubkey, verified_at FROM users
     WHERE phone = $1 AND verified_at IS NOT NULL`,
    [phone],
  )
  if (!result.rows[0]) return res.status(404).json({ error: 'Phone number is not registered' })
  res.json({
    phone: result.rows[0].phone,
    fiberPubkey: result.rows[0].fiber_pubkey,
    verifiedAt: result.rows[0].verified_at,
    lookupProof: {
      source: 'database',
      publicEndpoint: publicApiUrl(`/api/registry/lookup?phone=${encodeURIComponent(phone)}`),
    },
  })
}))

app.get('/api/fiber/receiver', asyncHandler(async (_req, res) => {
  const info = await getReceiverNodeInfo()
  res.json({
    receiver: {
      rpcUrl: config.fiberReceiverRpcUrl,
      ckbAddress: config.fiberReceiverCkbAddress,
      pubkey: info.pubkey,
      peersCount: info.peers_count,
      channelCount: info.channel_count,
      pendingChannelCount: info.pending_channel_count,
      defaultFundingLockScript: info.default_funding_lock_script,
    },
  })
}))

app.get('/api/fiber/operator', requireAuth, asyncHandler(async (_req, res) => {
  const operator = await getNodeInfo()
  const wsAddress = config.fiberOperatorWsAddr || browserPeerMultiaddr(_req)
  const fundingLockArg = operator.default_funding_lock_script?.args || ''
  res.json({
    operator,
    wsAddress,
    addrType: wsAddress.includes('/wss') ? 'wss' : 'ws',
    fundingAddress: fundingLockArg ? lockArgToAddress(fundingLockArg) : '',
  })
}))

app.post('/api/fiber/browser/diagnostics', requireAuth, asyncHandler(async (req, res) => {
  const pubkey = String(req.body.pubkey || req.user.fiber_pubkey || '').trim().toLowerCase()
  const temporaryChannelId = String(req.body.temporaryChannelId || '').trim().toLowerCase()
  if (!/^[0-9a-f]{66}$/.test(pubkey)) throw new Error('A valid browser Fiber pubkey is required')

  const [operatorResult, peersResult, channelsResult] = await Promise.allSettled([
    getNodeInfo(),
    listFiberPeers(),
    listChannelsByPeer(pubkey, { includeClosed: true }),
  ])

  const operator = operatorResult.status === 'fulfilled' ? operatorResult.value : {}
  const peers = peersResult.status === 'fulfilled' ? peersResult.value : { peers: [] }
  const channelsByPeer = channelsResult.status === 'fulfilled' ? channelsResult.value : { channels: [] }
  const operatorPeer = (peers.peers || []).find((peer) => String(peer.pubkey || '').toLowerCase() === pubkey)
  const channels = channelsByPeer.channels || []
  const matchingChannel = temporaryChannelId
    ? channels.find((channel) => String(channel.channel_id || '').toLowerCase() === temporaryChannelId
      || String(channel.temporary_channel_id || '').toLowerCase() === temporaryChannelId)
    : null
  const operatorErrors = [
    operatorResult.status === 'rejected' ? `node_info: ${operatorResult.reason?.message || operatorResult.reason}` : '',
    peersResult.status === 'rejected' ? `list_peers: ${peersResult.reason?.message || peersResult.reason}` : '',
    channelsResult.status === 'rejected' ? `list_channels: ${channelsResult.reason?.message || channelsResult.reason}` : '',
  ].filter(Boolean)
  const channelSummary = channels.map((channel) => ({
    channelId: channel.channel_id,
    temporaryChannelId: channel.temporary_channel_id,
    state: channelStateName(channel),
    flags: channel.state?.state_flags || channel.state_flags || '',
    localBalance: String(channel.local_balance || '0x0'),
    remoteBalance: String(channel.remote_balance || '0x0'),
    channelOutpoint: channel.channel_outpoint || null,
    isPublic: isPublicChannel(channel),
  }))

  console.log('fiber_browser_diagnostics', JSON.stringify({
    checkedAt: new Date().toISOString(),
    browserPubkey: pubkey,
    temporaryChannelId,
    operatorPubkey: operator.pubkey || null,
    operatorSeesBrowserPeer: Boolean(operatorPeer),
    operatorPeerAddress: operatorPeer?.address || operatorPeer?.addresses || null,
    operatorChannelCountForBrowser: channels.length,
    operatorSeesTemporaryChannel: Boolean(matchingChannel),
    operatorErrors,
    channelSummary,
  }))

  res.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    browserPubkey: pubkey,
    temporaryChannelId,
    operatorPubkey: operator.pubkey || '',
    operatorPeer: operatorPeer || null,
    operatorSeesBrowserPeer: Boolean(operatorPeer),
    operatorPeerAddress: operatorPeer?.address || operatorPeer?.addresses || '',
    operatorChannelCountForBrowser: channels.length,
    operatorChannelsForBrowser: channels,
    operatorChannelsSummary: channelSummary,
    operatorMatchingChannel: matchingChannel || null,
    operatorSeesTemporaryChannel: Boolean(matchingChannel),
    operatorErrors,
  })
}))

app.post('/api/fiber/browser/clear-operator-stale', requireAuth, asyncHandler(async (req, res) => {
  const pubkey = String(req.body.pubkey || req.user.fiber_pubkey || '').trim().toLowerCase()
  if (!/^[0-9a-f]{66}$/.test(pubkey)) throw new Error('A valid browser Fiber pubkey is required')

  const channelsByPeer = await listChannelsByPeer(pubkey)
  const staleChannels = (channelsByPeer.channels || []).filter((channel) => {
    const state = channelStateName(channel)
    return state
      && state !== 'ChannelReady'
      && !channel.channel_outpoint
  })

  const cleared = []
  const errors = []
  for (const channel of staleChannels) {
    try {
      await abandonFiberChannel(channel.channel_id)
      cleared.push(channel.channel_id)
    } catch (error) {
      errors.push(`${channel.channel_id}: ${error.message || String(error)}`)
    }
  }

  console.log('fiber_clear_operator_stale', JSON.stringify({
    checkedAt: new Date().toISOString(),
    browserPubkey: pubkey,
    staleCount: staleChannels.length,
    cleared,
    errors,
  }))

  res.json({ cleared, errors })
}))

app.post('/api/fiber/register-device', requireAuth, asyncHandler(async (req, res) => {
  const fiberPubkey = String(req.body.fiberPubkey || '').trim().toLowerCase()
  if (!/^[0-9a-f]{66}$/.test(fiberPubkey)) {
    throw new Error('A valid Fiber pubkey is required')
  }

  const updated = await query(
    `UPDATE users
     SET fiber_pubkey = $2,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [req.user.id, fiberPubkey],
  )

  const account = await query(
    'SELECT balance_base_units FROM ledger_accounts WHERE user_id = $1',
    [req.user.id],
  )

  res.json({
    ok: true,
    user: publicUser(updated.rows[0], account.rows[0]?.balance_base_units || '0'),
    walletMode: 'self_custody',
  })
}))

app.post('/api/fiber/browser/address', requireAuth, asyncHandler(async (req, res) => {
  const lockArg = String(req.body.lockArg || '').trim().toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(lockArg)) {
    throw new Error('A valid secp256k1 lock arg is required')
  }
  const [address, capacity, rusdBaseUnits] = await Promise.all([
    Promise.resolve(lockArgToAddress(lockArg)),
    capacityByLockArg(lockArg),
    udtAmountByLockArg(lockArg, RUSD_TYPE_SCRIPT),
  ])
  res.json({
    ok: true,
    address,
    lockArg,
    capacity,
    rusdBaseUnits: rusdBaseUnits.toString(),
  })
}))

app.post('/api/fiber/browser/fund-ckb', requireAuth, asyncHandler(async (req, res) => {
  const address = String(req.body.address || '').trim()
  const capacityCkb = Number(req.body.capacityCkb || 200)
  if (!address) throw new Error('A target testnet address is required')
  if (!Number.isFinite(capacityCkb) || capacityCkb <= 0) throw new Error('A positive capacity amount is required')
  const transfer = await transferDevCapacity(address, capacityCkb)
  res.json({ ok: true, transfer, fundedCapacityCkb: capacityCkb })
}))

app.post('/api/fiber/receiver/invoice', requireAuth, asyncHandler(async (req, res) => {
  const amountKes = Number(req.body.amountKes)
  const amountBaseUnits = toRUsdBaseUnits(amountKes)
  const invoice = await createReceiverInvoice({
    amountBaseUnits,
    description: `Dular M-Pesa deposit for ${req.user.phone}`,
  })
  const paymentHash = invoice.payment_hash || invoice.invoice?.data?.payment_hash
  if (!paymentHash) throw new Error('Receiver Fiber invoice did not include a payment hash')
  res.json({
    invoice: invoice.invoice_address,
    paymentHash,
    amountBaseUnits: amountBaseUnits.toString(),
    receiverRpcUrl: config.fiberReceiverRpcUrl,
  })
}))

app.post('/api/fiber/test-invoice', requireAuth, asyncHandler(async (req, res) => {
  const amountBaseUnits = BigInt(String(req.body.amountBaseUnits || '100000000'))
  const description = String(req.body.description || `Dular test invoice for ${req.user.phone}`).trim()
  const invoice = await createReceiverInvoice({ amountBaseUnits, description })
  const paymentHash = invoice.payment_hash || invoice.invoice?.data?.payment_hash
  res.json({
    ok: true,
    invoice: invoice.invoice_address,
    paymentHash,
    amountBaseUnits: amountBaseUnits.toString(),
  })
}))

app.get('/api/transactions', requireAuth, asyncHandler(async (req, res) => {
  const result = await query(
    `(SELECT
        id::text,
        kind,
        status,
        phone,
        kes_amount,
        rusd_base_units,
        checkout_request_id,
        merchant_request_id,
        conversation_id,
        originator_conversation_id,
        receipt_number,
        fiber_invoice,
        fiber_payment_hash,
        fiber_status,
        fiber_fee_base_units,
        fiber_route,
        credited_at,
        provider_payload,
        created_at,
        updated_at
      FROM mpesa_transactions
      WHERE user_id = $1)
     UNION ALL
     (SELECT
        id::text,
        CASE WHEN direction = 'debit' THEN 'phone_send' ELSE 'phone_receive' END AS kind,
        status,
        COALESCE(metadata->>'recipientPhone', metadata->>'senderPhone') AS phone,
        NULL::numeric AS kes_amount,
        amount_base_units AS rusd_base_units,
        NULL::text AS checkout_request_id,
        NULL::text AS merchant_request_id,
        NULL::text AS conversation_id,
        NULL::text AS originator_conversation_id,
        NULL::text AS receipt_number,
        NULL::text AS fiber_invoice,
        NULL::text AS fiber_payment_hash,
        NULL::text AS fiber_status,
        NULL::numeric AS fiber_fee_base_units,
        '[]'::jsonb AS fiber_route,
        CASE WHEN status = 'posted' THEN created_at ELSE NULL END AS credited_at,
        jsonb_build_object(
          'sourceId', source_id,
          'direction', direction,
          'counterpartyPhone', COALESCE(metadata->>'recipientPhone', metadata->>'senderPhone')
        ) AS provider_payload,
        created_at,
        created_at AS updated_at
      FROM ledger_entries
      WHERE user_id = $1 AND source_type = 'phone_payment')
     ORDER BY created_at DESC
     LIMIT 25`,
    [req.user.id],
  )
  res.json({ transactions: result.rows })
}))

app.get('/api/verification/deposit/:checkoutRequestId', asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT
       m.id,
       m.kind,
       m.phone,
       m.kes_amount,
       m.rusd_base_units,
       m.status,
       m.checkout_request_id,
       m.merchant_request_id,
       m.receipt_number,
       m.fiber_invoice,
       m.fiber_payment_hash,
       m.fiber_status,
       m.fiber_fee_base_units,
       m.fiber_route,
       m.credited_at,
       m.created_at,
       f.route AS payment_route,
       f.status AS payment_status
     FROM mpesa_transactions m
     LEFT JOIN fiber_payments f ON f.payment_hash = m.fiber_payment_hash
     WHERE m.checkout_request_id = $1`,
    [req.params.checkoutRequestId],
  )
  if (!result.rows[0]) return res.status(404).json({ error: 'Deposit not found' })
  res.json({ deposit: result.rows[0] })
}))

app.post('/api/mpesa/deposits/:id/settle-fiber', requireAuth, asyncHandler(async (req, res) => {
  const result = await withTransaction(async (client) => {
    const tx = await client.query(
      `SELECT * FROM mpesa_transactions
       WHERE id = $1 AND user_id = $2 AND kind = 'deposit'
       FOR UPDATE`,
      [req.params.id, req.user.id],
    )
    if (!tx.rows[0]) throw new Error('Deposit transaction not found')
    if (tx.rows[0].status !== 'mpesa_paid_fiber_pending') {
      throw new Error(`Deposit is not pending Fiber settlement: ${tx.rows[0].status}`)
    }
    return createFiberBackedDepositSettlement(client, tx.rows[0], {
      receipt: tx.rows[0].receipt_number,
      checkoutRequestId: tx.rows[0].checkout_request_id,
    })
  })
  res.json({ ok: true, settlement: result })
}))

app.post('/api/mpesa/deposits/:id/reconcile', requireAuth, asyncHandler(async (req, res) => {
  const current = await query(
    `SELECT * FROM mpesa_transactions
     WHERE id = $1 AND user_id = $2 AND kind = 'deposit'`,
    [req.params.id, req.user.id],
  )
  const currentTx = current.rows[0]
  if (!currentTx) return res.status(404).json({ error: 'Deposit transaction not found' })

  let stkQuery = null
  if (['initiating', 'pending'].includes(currentTx.status) && currentTx.checkout_request_id) {
    stkQuery = await queryStkPushStatus({ checkoutRequestId: currentTx.checkout_request_id })
  }

  const transaction = await withTransaction(async (client) => {
    const locked = await client.query(
      `SELECT * FROM mpesa_transactions
       WHERE id = $1 AND user_id = $2 AND kind = 'deposit'
       FOR UPDATE`,
      [req.params.id, req.user.id],
    )
    const tx = locked.rows[0]
    if (!tx) throw new Error('Deposit transaction not found')
    if (['completed', 'failed'].includes(tx.status)) return tx

    if (tx.status === 'mpesa_paid_fiber_pending') {
      return settlePaidDeposit(client, tx, {
        receipt: tx.receipt_number,
        checkoutRequestId: tx.checkout_request_id,
        providerPayload: { source: 'reconcile', message: 'Retrying pending Fiber settlement' },
        providerKey: 'fiberReconcile',
      })
    }

    if (!stkQuery) {
      return tx
    }

    return applyStkResult(client, tx, stkQuery, 'stkQuery')
  })

  res.json({ transaction, provider: stkQuery })
}))

app.post('/api/mpesa/deposit', requireAuth, asyncHandler(async (req, res) => {
  const amountKes = Number(req.body.amountKes)
  const fiberInvoice = String(req.body.fiberInvoice || '').trim()
  const fiberInvoicePaymentHash = String(req.body.fiberInvoicePaymentHash || '').trim()
  if (!fiberInvoice) throw new Error('A receiver Fiber invoice is required for testnet-backed deposits')
  if (!fiberInvoicePaymentHash) throw new Error('Receiver Fiber invoice payment hash is required')
  const rusdBaseUnits = toRUsdBaseUnits(amountKes)
  const tx = await query(
    `INSERT INTO mpesa_transactions
       (user_id, kind, phone, kes_amount, rusd_base_units, status, fiber_invoice, provider_payload)
     VALUES ($1, 'deposit', $2, $3, $4, 'initiating', $5, $6)
     RETURNING *`,
    [
      req.user.id,
      req.user.phone,
      amountKes,
      rusdBaseUnits.toString(),
      fiberInvoice,
      { requestedAt: new Date().toISOString(), fiberInvoicePaymentHash },
    ],
  )

  try {
    const mpesa = await initiateStkPush({
      phone: req.user.phone,
      amountKes,
      accountReference: `DULAR-${req.user.phone}`,
    })
    const updated = await query(
      `UPDATE mpesa_transactions
       SET status = 'pending',
           checkout_request_id = $2,
           merchant_request_id = $3,
           provider_payload = COALESCE(provider_payload, '{}'::jsonb) || $4::jsonb,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [tx.rows[0].id, mpesa.CheckoutRequestID, mpesa.MerchantRequestID, mergePayload('stkPush', mpesa)],
    )
    res.json({ transaction: updated.rows[0], provider: mpesa })
  } catch (error) {
    await query(
      `UPDATE mpesa_transactions
       SET status = 'failed',
           provider_payload = COALESCE(provider_payload, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [tx.rows[0].id, JSON.stringify({ stkError: error.message })],
    )
    throw error
  }
}))

app.post('/api/mpesa/withdraw', requireAuth, asyncHandler(async (req, res) => {
  const amountKes = Number(req.body.amountKes)
  const rusdBaseUnits = toRUsdBaseUnits(amountKes)
  const provider = await initiateB2c({
    phone: req.user.phone,
    amountKes,
    remarks: 'Dular RUSD withdrawal',
  })

  const tx = await withTransaction(async (client) => {
    const created = await client.query(
      `INSERT INTO mpesa_transactions
         (user_id, kind, phone, kes_amount, rusd_base_units, status, conversation_id, originator_conversation_id, provider_payload)
       VALUES ($1, 'withdrawal', $2, $3, $4, 'pending', $5, $6, $7)
       RETURNING *`,
      [
        req.user.id,
        req.user.phone,
        amountKes,
        rusdBaseUnits.toString(),
        provider.ConversationID,
        provider.OriginatorConversationID,
        provider,
      ],
    )
    await debit(client, {
      userId: req.user.id,
      amount: rusdBaseUnits,
      sourceType: 'mpesa_withdrawal',
      sourceId: created.rows[0].id,
      metadata: { phone: req.user.phone, amountKes },
    })
    return created.rows[0]
  })

  res.json({ transaction: tx, provider })
}))

app.post('/api/fiber/pay-invoice-bridge', requireAuth, asyncHandler(async (req, res) => {
  const invoice = String(req.body.invoice || '').trim()
  if (!invoice) throw new Error('A Fiber invoice is required')
  const payment = await sendFiberPayment(invoice)
  res.json({ ok: true, payment, mode: 'operator_bridge' })
}))

app.post('/api/fiber/browser/seed-liquidity', requireAuth, asyncHandler(async (req, res) => {
  const pubkey = String(req.body.pubkey || req.user.fiber_pubkey || '').trim().toLowerCase()
  const invoice = String(req.body.invoice || '').trim()
  const fundingAmountBaseUnits = BigInt(String(req.body.fundingAmountBaseUnits || '100000000'))
  const replacePending = Boolean(req.body.replacePending)

  if (!/^[0-9a-f]{66}$/.test(pubkey)) throw new Error('A valid browser Fiber pubkey is required')
  if (!invoice) throw new Error('A browser-created invoice is required')

  const prepared = await prepareBrowserOutboundChannel({ pubkey, fundingAmountBaseUnits, replacePending })
  const {
    connectedPeer,
    abandonedPendingChannels,
    channelBootstrap,
    pendingChannel,
    pendingChannels,
    readyChannel,
    outboundLiquidity,
    requiredOutboundLiquidity,
    operatorFundingAddress,
    operatorOnChainRUsd,
    nextAction,
  } = prepared

  if (!readyChannel) {
    res.json({
      ok: true,
      connected: true,
      peerAddress: connectedPeer.address,
      abandonedPendingChannels,
      channelBootstrap,
      pendingChannel,
      pendingChannels,
      readyChannel: null,
      payment: null,
      outboundLiquidity: outboundLiquidity.toString(),
      requiredOutboundLiquidity: requiredOutboundLiquidity.toString(),
      operatorFundingAddress,
      operatorOnChainRUsd: operatorOnChainRUsd === null || operatorOnChainRUsd === undefined ? null : operatorOnChainRUsd.toString(),
      nextAction,
    })
    return
  }

  const payment = await sendFiberPayment(invoice)

  res.json({
    ok: true,
    connected: true,
    peerAddress: connectedPeer.address,
    abandonedPendingChannels,
    channelBootstrap,
    pendingChannels,
    readyChannel,
    outboundLiquidity: outboundLiquidity.toString(),
    requiredOutboundLiquidity: requiredOutboundLiquidity.toString(),
    operatorFundingAddress,
    operatorOnChainRUsd: operatorOnChainRUsd === null || operatorOnChainRUsd === undefined ? null : operatorOnChainRUsd.toString(),
    payment,
  })
}))

app.post('/api/fiber/browser/prepare-receive-route', requireAuth, asyncHandler(async (req, res) => {
  const pubkey = String(req.body.pubkey || req.user.fiber_pubkey || '').trim().toLowerCase()
  const fundingAmountBaseUnits = BigInt(String(req.body.fundingAmountBaseUnits || '100000000'))
  const replacePending = Boolean(req.body.replacePending)

  if (!/^[0-9a-f]{66}$/.test(pubkey)) throw new Error('A valid browser Fiber pubkey is required')

  const prepared = await prepareBrowserOutboundChannel({ pubkey, fundingAmountBaseUnits, replacePending })
  const operator = await getNodeInfo()
  const hopHint = prepared.readyChannel ? hopHintForChannel(operator.pubkey, prepared.readyChannel) : null

  res.json({
    ok: true,
    mode: 'receive_route',
    connected: true,
    peerAddress: prepared.connectedPeer.address,
    abandonedPendingChannels: prepared.abandonedPendingChannels,
    channelBootstrap: prepared.channelBootstrap,
    pendingChannel: prepared.pendingChannel,
    pendingChannels: prepared.pendingChannels,
    readyChannel: prepared.readyChannel,
    outboundLiquidity: prepared.outboundLiquidity.toString(),
    requiredOutboundLiquidity: prepared.requiredOutboundLiquidity.toString(),
    operatorFundingAddress: prepared.operatorFundingAddress,
    operatorOnChainRUsd: prepared.operatorOnChainRUsd === null || prepared.operatorOnChainRUsd === undefined ? null : prepared.operatorOnChainRUsd.toString(),
    hopHints: hopHint ? [hopHint] : [],
    nextAction: prepared.nextAction,
  })
}))

app.post('/api/fiber/browser/invoice-route', requireAuth, asyncHandler(async (req, res) => {
  const invoice = String(req.body.invoice || '').trim()
  if (!invoice) throw new Error('A Fiber invoice is required')

  const parsed = await parseFiberInvoice(invoice)
  const payeePubkey = invoicePayeePubkey(parsed)
  const amountBaseUnits = invoiceAmount(parsed)
  const supportsHopHints = invoiceAllowsHopHints(parsed)
  if (!/^[0-9a-f]{66}$/.test(payeePubkey)) {
    throw new Error('Could not read a valid payee pubkey from this invoice')
  }

  const [operator, peers, channels] = await Promise.all([
    getNodeInfo(),
    listFiberPeers(),
    listChannelsByPeer(payeePubkey),
  ])
  const connectedPeer = peers.peers?.find((peer) => peer.pubkey.toLowerCase() === payeePubkey) || null
  const readyChannels = readyRoutableBrowserChannels(channels.channels || [])
  const outboundLiquidity = readyChannels.reduce((total, channel) => total + channelLocalBalance(channel), 0n)
  let routeChannel = readyChannels.find((channel) => channelLocalBalance(channel) >= amountBaseUnits) || null
  routeChannel = await ensureZeroFeeBrowserRoute(routeChannel)
  const hopHint = routeChannel ? hopHintForChannel(operator.pubkey, routeChannel) : null
  const estimatedFinalHopFeeBaseUnits = routeChannel ? forwardingFeeBaseUnits(amountBaseUnits, routeChannel) : 0n
  const routeReady = Boolean(connectedPeer && hopHint && supportsHopHints && outboundLiquidity >= amountBaseUnits)
  let reason = null
  if (!supportsHopHints) {
    reason = 'This invoice was created without hop-hint support. Ask the receiver to refresh the app, create a new invoice, then prepare the receiving route again.'
  } else if (!connectedPeer) {
    reason = 'Receiver browser wallet is not connected to the Dular operator. Keep the receiver wallet tab open, refresh network, then prepare the receiving route.'
  } else if (!hopHint) {
    reason = 'Receiver has no ready Dular operator route with enough inbound RUSD. Keep the receiver wallet open and prepare a receiving route.'
  }

  res.json({
    ok: true,
    operatorPubkey: operator.pubkey,
    payeePubkey,
    amountBaseUnits: amountBaseUnits.toString(),
    estimatedFinalHopFeeBaseUnits: estimatedFinalHopFeeBaseUnits.toString(),
    senderRequiredOutboundBaseUnits: (amountBaseUnits + estimatedFinalHopFeeBaseUnits).toString(),
    supportsHopHints,
    connected: Boolean(connectedPeer),
    peerAddress: connectedPeer?.address || null,
    routeReady,
    reason,
    outboundLiquidity: outboundLiquidity.toString(),
    hopHints: hopHint ? [hopHint] : [],
    routeChannel,
    readyChannels,
  })
}))

app.post('/api/payments/send-phone', requireAuth, asyncHandler(async (req, res) => {
  const recipientPhone = normalizePhone(req.body.phone)
  const amount = parseBaseUnits(req.body.amountBaseUnits)
  if (recipientPhone === req.user.phone) throw new Error('Cannot send to your own phone number')

  const result = await withTransaction(async (client) => {
    const recipient = await client.query(
      `SELECT * FROM users WHERE phone = $1 AND verified_at IS NOT NULL FOR UPDATE`,
      [recipientPhone],
    )
    if (!recipient.rows[0]) throw new Error('Recipient phone number is not registered')

    const paymentId = `phone-${Date.now()}-${req.user.id}-${recipient.rows[0].id}`
    await debit(client, {
      userId: req.user.id,
      amount,
      sourceType: 'phone_payment',
      sourceId: paymentId,
      metadata: { recipientPhone },
    })
    await credit(client, {
      userId: recipient.rows[0].id,
      amount,
      sourceType: 'phone_payment',
      sourceId: paymentId,
      metadata: { senderPhone: req.user.phone },
    })
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, event_type, entity_type, entity_id, metadata)
       VALUES ($1, 'send_phone', 'phone_payment', $2, $3)`,
      [req.user.id, paymentId, { recipientPhone, amountBaseUnits: amount.toString() }],
    )
    return { paymentId, recipient: recipient.rows[0] }
  })

  res.json({
    ok: true,
    paymentId: result.paymentId,
    recipient: {
      phone: result.recipient.phone,
      fiberPubkey: result.recipient.fiber_pubkey,
    },
  })
}))

app.post('/api/mpesa/callback/stk', asyncHandler(async (req, res) => {
  const callback = req.body?.Body?.stkCallback || req.body?.stkCallback || req.body
  const checkoutRequestId = callback.CheckoutRequestID
  const receipt = readStkReceipt(callback)

  await query(
    `INSERT INTO mpesa_callbacks (kind, conversation_id, result_code, receipt_number, payload)
     VALUES ('stk', $1, $2, $3, $4)`,
    [checkoutRequestId || null, String(callback.ResultCode ?? ''), receipt || null, req.body],
  )

  if (!checkoutRequestId) return res.json({ ok: true })

  await withTransaction(async (client) => {
    const tx = await client.query(
      `SELECT * FROM mpesa_transactions WHERE checkout_request_id = $1 FOR UPDATE`,
      [checkoutRequestId],
    )
    if (!tx.rows[0] || ['completed', 'failed'].includes(tx.rows[0].status)) return
    await applyStkResult(client, tx.rows[0], callback, 'stkCallback')
  })

  res.json({ ok: true })
}))

app.post('/api/mpesa/callback/b2c', asyncHandler(async (req, res) => {
  const result = req.body?.Result || req.body
  const conversationId = result.ConversationID
  const originatorConversationId = result.OriginatorConversationID
  const resultCode = Number(result.ResultCode)
  const receipt = result.ResultParameters?.ResultParameter?.find((item) => item.Key === 'TransactionReceipt')?.Value

  console.log('M-Pesa B2C callback', JSON.stringify({
    conversationId,
    originatorConversationId,
    resultCode,
    receipt,
  }))

  await query(
    `INSERT INTO mpesa_callbacks
       (kind, conversation_id, originator_conversation_id, result_code, receipt_number, payload)
     VALUES ('b2c', $1, $2, $3, $4, $5)`,
    [conversationId || null, originatorConversationId || null, String(result.ResultCode ?? ''), receipt || null, req.body],
  )

  await query(
    `UPDATE mpesa_transactions
     SET status = CASE WHEN $3 = 0 THEN 'completed' ELSE 'failed' END,
         receipt_number = COALESCE($4, receipt_number),
         provider_payload = $5,
         updated_at = now()
     WHERE conversation_id = $1 OR originator_conversation_id = $2`,
    [conversationId, originatorConversationId, resultCode, receipt || null, req.body],
  )

  res.json({ ok: true })
}))

app.post('/api/mpesa/callback/b2c-timeout', asyncHandler(async (req, res) => {
  console.log('M-Pesa B2C timeout callback', JSON.stringify(req.body))
  await query(
    `INSERT INTO mpesa_callbacks (kind, payload)
     VALUES ('b2c-timeout', $1)`,
    [req.body],
  )
  res.json({ ok: true })
}))

app.get('/api/mpesa/callbacks', asyncHandler(async (_req, res) => {
  const result = await query(
    `SELECT * FROM mpesa_callbacks ORDER BY created_at DESC LIMIT 25`,
  )
  res.json({ callbacks: result.rows })
}))

app.use((error, _req, res, next) => {
  void next
  console.error(error)
  res.status(400).json({ error: error.message || 'Request failed' })
})

const modulePath = fileURLToPath(import.meta.url)
const executedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''

if (executedPath === modulePath) {
  const server = createServer(app)
  const wss = new WebSocketServer({ noServer: true })

  wss.on('connection', (socket) => {
    const upstream = net.connect({ host: '127.0.0.1', port: 8228 })

    socket.on('message', (data, isBinary) => {
      upstream.write(isBinary ? data : Buffer.from(data))
    })

    upstream.on('data', (chunk) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(chunk, { binary: true })
      }
    })

    const closeBoth = () => {
      try {
        socket.close()
      } catch {
        // ignore close races between the ws and tcp sides
      }
      try {
        upstream.destroy()
      } catch {
        // ignore destroy races between the ws and tcp sides
      }
    }

    socket.on('close', closeBoth)
    socket.on('error', closeBoth)
    upstream.on('close', closeBoth)
    upstream.on('error', closeBoth)
  })

  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  })

  server.listen(config.port, () => {
    console.log(`Dular API listening on http://localhost:${config.port}`)
  })
}

export default app
