import { useCallback, useEffect, useRef, useState } from 'react'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { blake2b } from '@noble/hashes/blake2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Copy,
  ExternalLink,
  Home,
  KeyRound,
  Landmark,
  LockKeyhole,
  LogOut,
  Network,
  RefreshCw,
  SendHorizontal,
  ShieldCheck,
  Smartphone,
  WalletCards,
  Wifi,
} from 'lucide-react'
import {
  browserAcceptChannel,
  browserAbandonChannel,
  browserConnectPeer,
  browserCreateInvoice,
  browserGetPayment,
  browserListChannels,
  browserListPendingChannels,
  browserListPeers,
  browserNodeInfo,
  browserOpenRUsdChannel,
  browserSendKeysend,
  browserSendPayment,
  canUseBrowserFiber,
  getBrowserFiber,
  RUSD_TYPE_SCRIPT,
  startBrowserFiber,
  stopBrowserFiber,
  browserUpdateChannel,
} from './lib/fiberBrowserNode.js'
import {
  createWalletRecord,
  loadWalletRecord,
  unlockWalletRecord,
} from './lib/browserWalletStore.js'
import { clearAuthToken, getAuthToken, setAuthToken } from './lib/authToken.js'
import BrandMark from './BrandMark.jsx'
import heroArt from './assets/hero.png'
import {
  channelOpeningFailure,
  findChannelOpeningRecord,
} from './lib/selfFundedChannelPolicy.js'
import './App.css'

const RUSD_BASE = 100000000n
const CKB_HASH_PERSONALIZATION = utf8ToBytes('ckb-default-hash')
const MIN_OPERATOR_CHANNEL_CAPACITY = 200n * 100000000n
const CKB_TESTNET_FAUCET_URL = 'https://faucet.nervos.org/'
const RUSD_TESTNET_FAUCET_URL = 'https://testnet0815.stablepp.xyz/stablecoin'
const SELF_CUSTODY_NAV_ITEMS = [
  { id: 'home', label: 'Dashboard', Icon: Home },
  { id: 'mpesa', label: 'M-Pesa', Icon: Smartphone },
  { id: 'receive', label: 'Receive', Icon: ArrowDownLeft },
  { id: 'send', label: 'Send', Icon: ArrowUpRight },
  { id: 'wallet', label: 'Wallet', Icon: WalletCards },
]

const TERMINAL_RAMP_STATES = new Set([
  'completed',
  'failed',
  'cancelled',
  'canceled',
  'expired',
  'invoice_expired',
  'mpesa_failed',
  'quote_expired',
  'refunded',
])
const KES_FORMATTER = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 2 })

async function api(path, options = {}) {
  const authToken = getAuthToken()
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers || {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed: ${res.status}`)
  return body
}

function formatRUsd(value, compact = false) {
  const amount = BigInt(String(value || '0'))
  const whole = amount / RUSD_BASE
  const fraction = (amount % RUSD_BASE).toString().padStart(8, '0').replace(/0+$/, '')
  const display = `${whole}${fraction ? `.${fraction}` : ''}`
  return compact ? display : `${display} RUSD`
}

function formatKes(value) {
  const amount = Number(value || 0)
  return Number.isFinite(amount) ? KES_FORMATTER.format(amount) : 'KES 0'
}

function baseUnitsHex(value) {
  return `0x${BigInt(String(value || '0')).toString(16)}`
}

function createCkbRegistrationProof({ userId, fiberPubkey, fundingLockArg, secretKey }) {
  const publicKey = secp256k1.getPublicKey(secretKey, true)
  const derivedLockArg = `0x${bytesToHex(blake2b(publicKey, {
    dkLen: 32,
    personalization: CKB_HASH_PERSONALIZATION,
  })).slice(0, 40)}`
  if (derivedLockArg !== fundingLockArg) throw new Error('Browser CKB key does not match the Fiber funding lock')
  const message = utf8ToBytes(`Dular CKB wallet registration ${userId} ${fiberPubkey} ${fundingLockArg}`)
  return {
    ckbPublicKey: `0x${bytesToHex(publicKey)}`,
    ckbSignature: `0x${bytesToHex(secp256k1.sign(message, secretKey, { format: 'compact' }))}`,
  }
}

function rampStateName(order) {
  return String(order?.state || order?.status || '').trim().toLowerCase()
}

function isActiveRampOrder(order) {
  const state = rampStateName(order)
  return Boolean(order?.id) && !TERMINAL_RAMP_STATES.has(state)
}

function rampKind(order) {
  return String(order?.kind || '').toLowerCase().includes('withdraw') ? 'withdrawal' : 'deposit'
}

function rampBrowserInvoice(order) {
  return order?.browserInvoice || (rampKind(order) === 'deposit' ? order?.fiberInvoice : '') || ''
}

function rampOperatorInvoice(order) {
  return order?.operatorInvoice || (rampKind(order) === 'withdrawal' ? order?.fiberInvoice : '') || ''
}

function rampPaymentHash(order) {
  return order?.fiberPaymentHash || order?.paymentHash || ''
}

function rampErrorMessage(order) {
  return order?.errorMessage || order?.failureMessage || ''
}

function rampStateInfo(order) {
  const state = rampStateName(order)
  if (state === 'completed') return { label: 'Completed', tone: 'success' }
  if (state === 'refunded') return { label: 'Cash-out stopped and RUSD was refunded', tone: 'error' }
  if (['failed', 'cancelled', 'canceled', 'expired', 'invoice_expired', 'mpesa_failed', 'payout_unknown'].includes(state)) {
    return { label: order?.errorMessage || order?.failureMessage || (state.includes('expired') ? 'Expired' : 'Could not complete'), tone: 'error' }
  }
  if (state === 'mpesa_unknown') {
    return order?.checkoutRequestId
      ? { label: 'M-Pesa confirmation is delayed', tone: 'pending' }
      : { label: 'M-Pesa request status needs support review', tone: 'error' }
  }

  if (rampKind(order) === 'withdrawal') {
    if (['fiber_paid', 'rusd_received', 'b2c_submitting', 'b2c_pending', 'payout_pending', 'payout_submitted', 'mpesa_pending'].includes(state)) {
      return { label: 'M-Pesa payout is processing', tone: 'settling' }
    }
    if (['created', 'awaiting_rusd', 'awaiting_fiber', 'fiber_pending', 'payment_pending'].includes(state)) {
      return { label: 'Waiting for Fiber payment', tone: 'pending' }
    }
    if (state === 'payout_failed') {
      return { label: 'Payout failed; RUSD refund required', tone: 'error' }
    }
    if (state === 'refund_pending') {
      return { label: 'RUSD refund is processing', tone: 'settling' }
    }
  } else {
    if (['mpesa_paid', 'mpesa_confirmed', 'fiber_pending', 'fiber_sending', 'delivery_pending', 'settling', 'payment_pending'].includes(state)) {
      return { label: 'M-Pesa received, RUSD is settling', tone: 'settling' }
    }
    if (['mpesa_initiating', 'stk_pending', 'stk_started', 'awaiting_mpesa', 'mpesa_pending'].includes(state)) {
      return { label: 'Waiting for M-Pesa confirmation', tone: 'pending' }
    }
    if (['created', 'awaiting_invoice', 'invoice_attached', 'invoice_ready'].includes(state)) {
      return { label: 'Preparing your wallet to receive', tone: 'pending' }
    }
  }

  return {
    label: state ? state.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase()) : 'Processing',
    tone: 'pending',
  }
}

function upsertRampOrder(orders, order) {
  if (!order?.id) return orders
  const remaining = orders.filter((item) => item.id !== order.id)
  return [order, ...remaining].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
}

function invoiceAttribute(invoice, ...keys) {
  const canonical = (value) => String(value || '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
    .replace('publickey', 'pubkey')
    .replace('typescript', 'script')
  const requested = keys.map(canonical)
  for (const attr of invoice?.data?.attrs || []) {
    const taggedName = attr?.name ?? attr?.type ?? attr?.kind
    if (taggedName && requested.includes(canonical(taggedName))) {
      return attr.value ?? attr.data ?? null
    }
    for (const [key, value] of Object.entries(attr || {})) {
      if (requested.includes(canonical(key))) return value
    }
  }
  return null
}

function serializeTypeScript(script) {
  const codeHash = String(script.code_hash || '').replace(/^0x/, '')
  const args = String(script.args || '').replace(/^0x/, '')
  const hashType = { data: '00', type: '01', data1: '02', data2: '04' }[script.hash_type]
  if (codeHash.length !== 64 || args.length % 2 !== 0 || !hashType) {
    throw new Error('The configured RUSD type script is invalid')
  }
  const uint32Le = (value) => [0, 8, 16, 24]
    .map((shift) => ((value >>> shift) & 0xff).toString(16).padStart(2, '0'))
    .join('')
  const argsLength = args.length / 2
  const firstFieldOffset = 16
  const argsOffset = firstFieldOffset + 32 + 1
  const totalLength = argsOffset + 4 + argsLength
  return `0x${uint32Le(totalLength)}${uint32Le(firstFieldOffset)}${uint32Le(firstFieldOffset + 32)}${uint32Le(argsOffset)}${codeHash}${hashType}${uint32Le(argsLength)}${args}`
}

async function validateOperatorInvoice({
  invoiceAddress,
  operatorPubkey,
  expectedAmountBaseUnits,
  expectedDescription,
  expectedPaymentHash,
}) {
  const fiber = getBrowserFiber()
  if (typeof fiber.parseInvoice !== 'function') {
    throw new Error('This browser Fiber version cannot validate the M-Pesa payout request')
  }

  const parsed = await fiber.parseInvoice({ invoice: invoiceAddress })
  const invoice = parsed?.invoice
  if (!invoice) throw new Error('The M-Pesa operator returned an unreadable Fiber invoice')

  const payee = invoiceAttribute(invoice, 'PayeePublicKey', 'payee_public_key', 'payeePubkey')
  if (normalizePubkey(payee) !== normalizePubkey(operatorPubkey)) {
    throw new Error('The cash-out invoice payee does not match the Dular operator')
  }
  if (BigInt(invoice.amount || '0x0') !== BigInt(String(expectedAmountBaseUnits))) {
    throw new Error('The cash-out invoice amount does not match this quote')
  }
  if (invoice.currency !== 'Fibt') {
    throw new Error('The cash-out invoice is not for the Fiber testnet')
  }

  const expectedScript = serializeTypeScript(RUSD_TYPE_SCRIPT).toLowerCase()
  const serializedRUsd = invoiceAttribute(invoice, 'UdtScript', 'udt_script', 'udtScript', 'udt_type_script')
  const hasRUsd = String(serializedRUsd || '').toLowerCase() === expectedScript
  if (!hasRUsd) throw new Error('The cash-out invoice is not denominated in RUSD')

  const description = invoiceAttribute(invoice, 'Description', 'description')
  if (description !== expectedDescription) throw new Error('The cash-out invoice description does not match this order')
  const paymentHash = String(invoice.data?.payment_hash || invoice.data?.paymentHash || invoice.payment_hash || invoice.paymentHash || '').toLowerCase()
  if (!/^0x[0-9a-f]{64}$/.test(paymentHash) || paymentHash !== String(expectedPaymentHash || '').toLowerCase()) {
    throw new Error('The cash-out invoice payment hash does not match this order')
  }
  if (typeof invoice.signature !== 'string' || !invoice.signature.trim()) {
    throw new Error('The cash-out invoice is missing its Fiber signature')
  }

  const timestamp = BigInt(String(invoice.data?.timestamp || '0x0'))
  const expirySeconds = BigInt(String(invoiceAttribute(invoice, 'ExpiryTime', 'expiry_time', 'expiryTime') || '0x0'))
  if (timestamp + (expirySeconds * 1000n) < BigInt(Date.now() + 60_000)) {
    throw new Error('The cash-out invoice has expired or has less than one minute remaining')
  }
  return parsed
}

function operatorRUsdAutoAcceptBaseUnits(operatorInfo) {
  const rusdInfo = (operatorInfo?.operator?.udt_cfg_infos || []).find((asset) => asset.name === 'RUSD')
  const raw = rusdInfo?.auto_accept_amount
  if (!raw) return 0n
  return BigInt(String(raw))
}

function sumChannelBalance(channels = []) {
  return channels.reduce((total, channel) => total + BigInt(channel.local_balance || '0x0'), 0n)
}

function isRUsdChannel(channel) {
  const script = channel?.funding_udt_type_script
  return Boolean(script)
    && String(script.code_hash || '').toLowerCase() === RUSD_TYPE_SCRIPT.code_hash
    && String(script.hash_type || '').toLowerCase() === RUSD_TYPE_SCRIPT.hash_type
    && String(script.args || '').toLowerCase() === RUSD_TYPE_SCRIPT.args
}

function channelStateName(channel) {
  return channel?.state?.state_name || channel?.state_name || ''
}

function isReadyChannel(channel) {
  return channelStateName(channel) === 'ChannelReady' && channel.enabled !== false && isRUsdChannel(channel)
}

function getFundingLockArg(info) {
  return info?.default_funding_lock_script?.args
    || info?.defaultFundingLockScript?.args
    || ''
}

function toBaseUnitsHex(value) {
  return `0x${toBaseUnits(value).toString(16)}`
}

function toBaseUnits(value) {
  const raw = String(value || '').trim()
  if (!/^\d+(\.\d{1,8})?$/.test(raw)) throw new Error('Enter a valid RUSD amount')
  const [whole, fraction = ''] = raw.split('.')
  return BigInt(whole) * RUSD_BASE + BigInt(fraction.padEnd(8, '0'))
}

function shortId(value = '', head = 10) {
  if (!value) return ''
  if (value.length <= head * 2) return value
  return `${value.slice(0, head)}...${value.slice(-head)}`
}

function errorMessage(error, fallback) {
  if (!error) return fallback
  if (typeof error === 'string') return error
  if (error.message) return error.message
  try {
    return JSON.stringify(error)
  } catch {
    return fallback
  }
}

function Status({ state }) {
  if (!state) return null
  const Icon = state.type === 'success' ? CheckCircle2 : state.type === 'error' ? CircleAlert : Clock3
  return (
    <div className={`statusMessage ${state.type}`} role={state.type === 'error' ? 'alert' : 'status'} aria-live="polite">
      <Icon size={18} aria-hidden="true" />
      <span>{state.message}</span>
    </div>
  )
}

function isMissingTempChannelError(error) {
  return /No channel with temp id/i.test(error?.message || String(error || ''))
}

function paymentStatusName(payment) {
  return payment?.status || payment?.state || 'Unknown'
}

function isFailedPaymentStatus(status) {
  return ['Failed', 'Cancelled', 'Canceled', 'Timeout'].includes(status)
}

function isPaymentNotFoundError(error) {
  return /not found|no payment|unknown payment/i.test(error?.message || String(error || ''))
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (!value) return
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <button type="button" className="copyBtn" onClick={copy} disabled={!value}>
      {copied ? <Check size={17} /> : <Copy size={17} />}
      {copied ? 'Copied' : label}
    </button>
  )
}

function ProofDrawer({ summary = 'Advanced details', children }) {
  return (
    <details className="proofDrawer">
      <summary>{summary}</summary>
      <div className="proofPanel compactProof">{children}</div>
    </details>
  )
}

function WalletHero() {
  return (
    <section className="authHero selfCustodyHero">
      <div className="authBrand"><BrandMark /><strong>Dular</strong><span>Testnet</span></div>
      <img className="fiberHeroArt" src={heroArt} alt="Fiber payment layers" />
      <div className="authHeroContent">
        <p className="eyebrow">Self-custody wallet</p>
        <h1>Your keys. Direct RUSD payments.</h1>
        <p>Your wallet keys stay encrypted on this device. Use testnet funds to try payments over Fiber.</p>
        <div className="authFeatureList" aria-label="Wallet features">
          <span><KeyRound size={18} /> Device-held wallet keys</span>
          <span><Network size={18} /> Direct Fiber payments</span>
          <span><ShieldCheck size={18} /> PIN-protected local storage</span>
        </div>
      </div>
    </section>
  )
}

function AuthGate({ onAuth }) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [demoCode, setDemoCode] = useState('')
  const [step, setStep] = useState('phone')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(null)

  async function requestOtp(event) {
    event.preventDefault()
    setLoading(true)
    setStatus(null)
    try {
      const result = await api('/auth/request-otp', {
        method: 'POST',
        body: JSON.stringify({ phone }),
      })
      setPhone(result.phone)
      setDemoCode(result.demoCode || '')
      setStep('code')
      setStatus({ type: 'success', message: 'SMS code sent. Enter it to continue to your device wallet.' })
    } catch (error) {
      setStatus({ type: 'error', message: error.message })
    } finally {
      setLoading(false)
    }
  }

  async function verifyOtp(event) {
    event.preventDefault()
    setLoading(true)
    setStatus(null)
    try {
      const result = await api('/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ phone, code }),
      })
      setAuthToken(result.token)
      await onAuth(result.user)
    } catch (error) {
      setStatus({ type: 'error', message: error.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="authShell">
      <WalletHero />
      <section className="authPanel">
        {step === 'phone' ? (
          <form onSubmit={requestOtp}>
            <span className="stepPill">Step 1 of 2</span>
            <h2>Sign in to Dular</h2>
            <p className="muted">Your verified number connects your Dular profile to this device wallet.</p>
            <div className="formGroup">
              <label htmlFor="self-phone">Phone number</label>
              <input id="self-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0712 345 678" required />
            </div>
            <button type="submit" className="primaryBtn fullWidth" disabled={loading}>{loading ? 'Sending SMS code...' : 'Send SMS code'}<ArrowRight size={18} /></button>
          </form>
        ) : (
          <form onSubmit={verifyOtp}>
            <span className="stepPill">Step 2 of 2</span>
            <h2>Enter your SMS code</h2>
            <p className="muted">We sent a 6-digit code to {phone}. {demoCode ? `Demo code: ${demoCode}` : ''}</p>
            <div className="formGroup">
              <label htmlFor="self-code">6-digit code</label>
              <input id="self-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="123456" required />
            </div>
            <div className="buttonRow">
              <button type="button" className="secondaryBtn" onClick={() => setStep('phone')}>Change number</button>
              <button type="submit" className="primaryBtn" disabled={loading}>{loading ? 'Verifying...' : 'Continue'}<ArrowRight size={18} /></button>
            </div>
          </form>
        )}
        <Status state={status} />
      </section>
    </main>
  )
}

function SetupCard({ phone, onCreate, onUnlock, hasExistingWallet, walletBound, loading, status }) {
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')

  async function createWallet(event) {
    event.preventDefault()
    await onCreate(pin, confirmPin)
  }

  async function unlockWallet(event) {
    event.preventDefault()
    await onUnlock(pin)
  }

  return (
    <div className="screenStack">
      <section className="contentCard">
        <div className="sectionIcon"><LockKeyhole size={20} /></div>
        <p className="eyebrow">Device security</p>
        <h1>{hasExistingWallet ? 'Unlock this wallet' : walletBound ? 'Original wallet required' : 'Create a device wallet'}</h1>
        <p className="muted">
          Your PIN encrypts the wallet stored in this browser. Dular cannot recover this test wallet if its browser data is cleared.
        </p>
        {hasExistingWallet ? (
          <form onSubmit={unlockWallet}>
            <div className="formGroup">
              <label htmlFor="unlock-pin">Wallet PIN</label>
              <input id="unlock-pin" type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(event) => setPin(event.target.value)} placeholder="At least 4 digits" required />
            </div>
            <button type="submit" className="primaryBtn fullWidth" disabled={loading}>{loading ? 'Unlocking...' : `Unlock ${phone}`}</button>
          </form>
        ) : walletBound ? (
          <div className="statusMessage warning">
            This account is already linked to a device wallet. Open it in the browser profile where it was created.
          </div>
        ) : (
          <form onSubmit={createWallet}>
            <div className="formGroup">
              <label htmlFor="create-pin">Create wallet PIN</label>
              <input id="create-pin" type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(event) => setPin(event.target.value)} placeholder="At least 4 digits" required />
            </div>
            <div className="formGroup">
              <label htmlFor="confirm-pin">Confirm wallet PIN</label>
              <input id="confirm-pin" type="password" inputMode="numeric" autoComplete="new-password" value={confirmPin} onChange={(event) => setConfirmPin(event.target.value)} placeholder="Enter the same PIN" required />
            </div>
            <button type="submit" className="primaryBtn fullWidth" disabled={loading}>{loading ? 'Creating wallet...' : 'Create wallet'}</button>
          </form>
        )}
        <Status state={status} />
      </section>
    </div>
  )
}

function SelfCustodyDashboard({
  user,
  nodeInfo,
  operatorInfo,
  peers,
  channels,
  funding,
  walletStatus,
  networkStatus,
  refreshingNetwork,
  lastNetworkRefreshAt,
  onLock,
  onSignOut,
  onRefreshNetwork,
}) {
  const [tab, setTab] = useState('home')
  const readyChannels = (channels?.channels || []).filter(isReadyChannel)
  const spendableBaseUnits = sumChannelBalance(readyChannels)
  const spendableBalance = formatRUsd(spendableBaseUnits)
  const onChainRUsdBaseUnits = BigInt(String(funding?.rusdBaseUnits || '0'))
  const onChainRUsdBalance = formatRUsd(onChainRUsdBaseUnits)
  const walletAddress = funding?.address || ''
  const hasSpendableFunds = spendableBaseUnits > 0n
  const hasOnChainFunds = onChainRUsdBaseUnits > 0n
  const betaPhase = hasSpendableFunds ? 'ready' : hasOnChainFunds ? 'activate' : 'fund'
  const betaCopy = {
    fund: 'Add testnet CKB and RUSD from the faucets to begin.',
    activate: 'On-chain RUSD detected. Move it into a Fiber channel before spending.',
    ready: 'Your RUSD is ready for Fiber payments.',
  }[betaPhase]
  const channelCount = readyChannels.length
  const peerCount = peers?.peers?.length || 0

  function openTab(nextTab) {
    setTab(nextTab)
    window.scrollTo(0, 0)
  }

  return (
    <main className="appShell">
      <header className="appTopbar">
        <div className="brandLockup">
          <BrandMark small />
          <div>
            <strong>Dular</strong>
            <span>Self-custody testnet · {user.phone}</span>
          </div>
        </div>
        <div className={`connectionBadge ${walletStatus === 'ready' ? '' : 'syncing'}`}>
          {walletStatus === 'ready' ? <Wifi size={14} /> : <RefreshCw size={14} className="spin" />}
          {walletStatus === 'ready' ? 'Connected' : 'Starting'}
        </div>
      </header>

      <div className="selfCustodyWorkspace">
        <nav className="desktopNav selfCustodyNav" aria-label="Wallet sections">
          {SELF_CUSTODY_NAV_ITEMS.map(({ id, label, Icon }) => (
            <button
              type="button"
              className={tab === id ? 'active' : ''}
              aria-current={tab === id ? 'page' : undefined}
              key={id}
              onClick={() => openTab(id)}
            >
              <Icon size={17} /> {label}
            </button>
          ))}
        </nav>

        <section className="phoneFrame selfCustodyFrame">
        <section className="walletPanel" role="tabpanel" aria-label="Wallet dashboard" hidden={tab !== 'home'}>
          <div className="screenStack">
          <section className="balanceCard walletBalanceCard">
            <div className="balanceTopline">
              <span>Spendable balance</span>
              <button type="button" className="ghostBtn iconTextBtn" onClick={() => onRefreshNetwork()} disabled={refreshingNetwork}>
                <RefreshCw size={16} className={refreshingNetwork ? 'spin' : ''} /> {refreshingNetwork ? 'Updating' : 'Update'}
              </button>
            </div>
            <strong>{spendableBalance}</strong>
            <div className="balanceBreakdown">
              <span>On-chain, not spendable</span>
              <strong>{onChainRUsdBalance}</strong>
            </div>
            <p>{betaCopy}</p>
            <div className="heroActionRow">
              {betaPhase === 'fund' && walletAddress && (
                <CopyButton value={walletAddress} label="Copy address" />
              )}
              {betaPhase === 'fund' && (
                <button type="button" className="secondaryBtn" onClick={() => openTab('fund')}>
                  Open faucet steps
                </button>
              )}
              {betaPhase === 'activate' && (
                <button type="button" className="secondaryBtn" onClick={() => openTab('fund')}>
                  Make RUSD spendable
                </button>
              )}
              {betaPhase === 'ready' && (
                <>
                  <button type="button" className="secondaryBtn" onClick={() => openTab('send')}>
                    <ArrowUpRight size={17} /> Send
                  </button>
                  <button type="button" className="secondaryBtn" onClick={() => openTab('receive')}>
                    <ArrowDownLeft size={17} /> Receive
                  </button>
                </>
              )}
              <button type="button" className="secondaryBtn" onClick={() => openTab('mpesa')}>
                <Smartphone size={17} /> M-Pesa
              </button>
            </div>
            <div className="networkSnapshot">
              <span><Network size={14} /> {channelCount} ready channel{channelCount === 1 ? '' : 's'}</span>
              <span>{peerCount} network peer{peerCount === 1 ? '' : 's'}</span>
              {lastNetworkRefreshAt && <span>Updated {lastNetworkRefreshAt}</span>}
            </div>
            <Status state={networkStatus} />
          </section>

          <BetaFlowCard phase={betaPhase} />
          </div>
        </section>

        <section className="walletPanel" role="tabpanel" aria-label="M-Pesa" hidden={tab !== 'mpesa'}>
          <div className="screenStack">
            <MpesaRampCard
              nodeInfo={nodeInfo}
              operatorInfo={operatorInfo}
              onRefreshNetwork={onRefreshNetwork}
            />
          </div>
        </section>

        <section className="walletPanel" role="tabpanel" aria-label="Fund wallet" hidden={tab !== 'fund'}>
          <div className="screenStack">
            <section className="flowHero">
              <button type="button" className="secondaryBtn backToWalletBtn" onClick={() => openTab('wallet')}>
                <ArrowLeft size={17} /> Back to wallet
              </button>
              <p className="eyebrow">Fund</p>
              <h1>Fund your wallet</h1>
              <p>Add testnet assets, confirm they arrived, and move RUSD into a Fiber channel.</p>
            </section>
            <section className="contentCard mobileActionCard">
            <div className="sectionHeader">
              <div>
                <p className="eyebrow">Step 1 · Testnet funds</p>
                <h2>Your funding address</h2>
              </div>
              <span className="safePill"><ExternalLink size={14} /> External faucets</span>
            </div>
            <p className="muted">
              Send testnet CKB and RUSD from the external faucets to your address, then update the wallet balance.
            </p>
            <FundingAddressCard
              walletAddress={walletAddress}
              funding={funding}
              onRefreshNetwork={onRefreshNetwork}
              refreshingNetwork={refreshingNetwork}
            />
            <TopUpCard
              nodeInfo={nodeInfo}
              walletAddress={walletAddress}
              funding={funding}
              operatorInfo={operatorInfo}
              onRefreshNetwork={onRefreshNetwork}
            />
            </section>
          </div>
        </section>

        <section className="walletPanel" role="tabpanel" aria-label="Receive RUSD" hidden={tab !== 'receive'}>
          <div className="screenStack">
            <section className="flowHero">
              <p className="eyebrow">Receive</p>
              <h1>Create a payment request</h1>
              <p>Set an amount and share the request with another Dular wallet.</p>
            </section>
            <section className="contentCard mobileActionCard">
              <ReceiveCard nodeInfo={nodeInfo} onRefreshNetwork={onRefreshNetwork} />
            </section>
          </div>
        </section>

        <section className="walletPanel" role="tabpanel" aria-label="Send RUSD" hidden={tab !== 'send'}>
          <div className="screenStack">
            <section className="flowHero">
              <p className="eyebrow">Send</p>
              <h1>Send RUSD</h1>
              <p>Pay a registered Dular number directly or use a Fiber payment request.</p>
            </section>
            <section className="contentCard mobileActionCard">
              <SendCard nodeInfo={nodeInfo} onRefreshNetwork={onRefreshNetwork} />
            </section>
          </div>
        </section>

        <section className="walletPanel" role="tabpanel" aria-label="Wallet security" hidden={tab !== 'wallet'}>
          <div className="screenStack">
            <section className="flowHero">
              <p className="eyebrow">Wallet</p>
              <h1>Security and access</h1>
              <p>Review this device wallet, inspect its network identity, or end your session.</p>
            </section>
            <section className="contentCard safetyCard">
            <div className="sectionHeader">
              <div>
                <p className="eyebrow">Device wallet</p>
                <h2>This browser</h2>
              </div>
              <span className="safePill"><KeyRound size={14} /> Keys on device</span>
            </div>
            <div className="safetyList">
              <span><ShieldCheck size={18} /> Your wallet is encrypted in this browser with your PIN.</span>
              <span><Smartphone size={18} /> Keep this tab open while a channel or payment is processing.</span>
              <span><CircleAlert size={18} /> Clearing browser data permanently removes this test wallet.</span>
            </div>
            <ProofDrawer summary="Wallet technical details">
              <ProofRow label="Phone" value={user.phone} />
              <ProofRow label="Wallet pubkey" value={user.fiberPubkey || nodeInfo?.pubkey || 'Pending'} />
              <ProofRow label="Wallet address" value={walletAddress || 'Loading...'} />
              <ProofRow label="Node pubkey" value={nodeInfo?.pubkey || 'Not loaded'} />
              <ProofRow label="Addresses" value={nodeInfo?.addresses?.join(', ') || 'Not advertised'} />
              <ProofRow label="Wallet CKB capacity" value={funding?.capacity || 'Unknown'} />
              <ProofRow label="Wallet on-chain RUSD" value={onChainRUsdBalance} />
              <ProofRow label="Spendable RUSD" value={spendableBalance} />
            </ProofDrawer>
            <div className="buttonRow wrapButtons">
              <button type="button" className="secondaryBtn iconTextBtn" onClick={() => openTab('fund')}><Landmark size={17} /> Testnet funding</button>
              <button type="button" className="secondaryBtn iconTextBtn" onClick={onLock}><LockKeyhole size={17} /> Lock wallet</button>
              <button type="button" className="secondaryBtn iconTextBtn" onClick={onSignOut}><LogOut size={17} /> Sign out</button>
            </div>
            </section>
          </div>
        </section>
        </section>
      </div>
      <nav className="bottomNav" aria-label="Wallet navigation">
        {SELF_CUSTODY_NAV_ITEMS.map(({ id, label, Icon }) => (
          <button
            type="button"
            className={tab === id ? 'active' : ''}
            aria-current={tab === id ? 'page' : undefined}
            key={id}
            onClick={() => openTab(id)}
          >
            <Icon size={20} />
            {label}
          </button>
        ))}
      </nav>
    </main>
  )
}

function MpesaRampCard({ nodeInfo, operatorInfo, onRefreshNetwork }) {
  const [direction, setDirection] = useState('deposit')
  const [config, setConfig] = useState(null)
  const [amounts, setAmounts] = useState({ deposit: '', withdrawal: '' })
  const [quotes, setQuotes] = useState({ deposit: null, withdrawal: null })
  const [currentOrders, setCurrentOrders] = useState({ deposit: null, withdrawal: null })
  const [stages, setStages] = useState({ deposit: 'amount', withdrawal: 'amount' })
  const [statuses, setStatuses] = useState({ deposit: null, withdrawal: null })
  const [routeIssue, setRouteIssue] = useState(null)
  const [orders, setOrders] = useState([])
  const [loadingDirection, setLoadingDirection] = useState('')
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [refreshingOrders, setRefreshingOrders] = useState(false)
  const [configStatus, setConfigStatus] = useState(null)
  const [activityStatus, setActivityStatus] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const idempotencyKeys = useRef({ deposit: '', withdrawal: '' })
  const pollingOrders = useRef(false)

  const quote = quotes[direction]
  const currentOrder = currentOrders[direction]
  const status = statuses[direction]
  const stage = stages[direction]
  const amount = amounts[direction]
  const loading = loadingDirection === direction
  const operatorPubkey = operatorInfo?.operator?.pubkey || ''
  const quoteSecondsLeft = quote?.expiresAt
    ? Math.max(0, Math.ceil((new Date(quote.expiresAt).getTime() - now) / 1000))
    : 0
  const quoteExpired = Boolean(quote?.expiresAt) && quoteSecondsLeft === 0
  const activeOrderIds = orders.filter(isActiveRampOrder).map((order) => order.id).join('|')
  const refundLeaseRunning = rampStateName(currentOrders.withdrawal) === 'refund_sending'

  function updateStatus(forDirection, nextStatus) {
    setStatuses((current) => ({ ...current, [forDirection]: nextStatus }))
  }

  function updateStage(forDirection, nextStage) {
    setStages((current) => ({ ...current, [forDirection]: nextStage }))
  }

  function updateCurrentOrder(forDirection, order) {
    setCurrentOrders((current) => ({ ...current, [forDirection]: order }))
    setOrders((current) => upsertRampOrder(current, order))
  }

  function createIdempotencyKey(forDirection) {
    const key = globalThis.crypto.randomUUID()
    idempotencyKeys.current[forDirection] = key
    return key
  }

  function validateKesAmount(rawAmount) {
    const kesAmount = Number(rawAmount)
    if (!Number.isSafeInteger(kesAmount) || kesAmount <= 0) throw new Error('Enter a whole KES amount')
    if (config?.minKes !== undefined && kesAmount < Number(config.minKes)) {
      throw new Error(`The minimum M-Pesa amount is ${formatKes(config.minKes)}`)
    }
    if (config?.maxKes !== undefined && kesAmount > Number(config.maxKes)) {
      throw new Error(`The maximum M-Pesa amount is ${formatKes(config.maxKes)}`)
    }
    return kesAmount
  }

  useEffect(() => {
    let active = true

    async function loadRamp() {
      const [configResult, ordersResult] = await Promise.allSettled([
        api('/ramp/config'),
        api('/ramp/orders'),
      ])
      if (!active) return

      if (configResult.status === 'fulfilled') {
        setConfig(configResult.value)
        setConfigStatus(null)
      } else {
        setConfigStatus({ type: 'error', message: errorMessage(configResult.reason, 'Could not load M-Pesa availability.') })
      }
      if (ordersResult.status === 'fulfilled') {
        const nextOrders = ordersResult.value.orders || []
        setOrders(nextOrders)
        setCurrentOrders({
          deposit: nextOrders.find((order) => rampKind(order) === 'deposit' && isActiveRampOrder(order)) || null,
          withdrawal: nextOrders.find((order) => rampKind(order) === 'withdrawal' && isActiveRampOrder(order)) || null,
        })
      } else {
        setActivityStatus({ type: 'error', message: errorMessage(ordersResult.reason, 'Could not load recent M-Pesa activity.') })
      }
      setLoadingConfig(false)
    }

    loadRamp()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!quotes.deposit && !quotes.withdrawal && !refundLeaseRunning) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [quotes.deposit, quotes.withdrawal, refundLeaseRunning])

  useEffect(() => {
    if (!activeOrderIds) return undefined

    const ids = activeOrderIds.split('|')
    async function poll() {
      if (pollingOrders.current) return
      pollingOrders.current = true
      try {
        const reconciliations = await Promise.allSettled(ids.map((id) => api(`/ramp/orders/${id}/reconcile`, { method: 'POST' })))
        const result = await api('/ramp/orders')
        const nextOrders = result.orders || []
        const trackedOrders = {
          deposit: nextOrders.find((order) => ids.includes(order.id) && rampKind(order) === 'deposit')
            || nextOrders.find((order) => rampKind(order) === 'deposit' && isActiveRampOrder(order))
            || null,
          withdrawal: nextOrders.find((order) => ids.includes(order.id) && rampKind(order) === 'withdrawal')
            || nextOrders.find((order) => rampKind(order) === 'withdrawal' && isActiveRampOrder(order))
            || null,
        }
        setOrders(nextOrders)
        setCurrentOrders(trackedOrders)
        const reconcileErrors = reconciliations
          .filter((item) => item.status === 'rejected')
          .map((item) => errorMessage(item.reason, 'One order could not be reconciled.'))
        setActivityStatus(reconcileErrors.length
          ? { type: 'warning', message: `Some M-Pesa status checks will retry automatically. ${reconcileErrors.join(' ')}` }
          : null)

        for (const forDirection of ['deposit', 'withdrawal']) {
          const tracked = trackedOrders[forDirection]
          if (!tracked) continue
          const state = rampStateName(tracked)
          if (state === 'completed') {
            updateStage(forDirection, 'completed')
            updateStatus(forDirection, {
              type: 'success',
              message: forDirection === 'deposit'
                ? `${formatRUsd(tracked.rusdAmountBaseUnits)} is now settled in this wallet.`
                : `${formatKes(tracked.kesAmount)} was sent to your M-Pesa account.`,
            })
          } else if (TERMINAL_RAMP_STATES.has(state)) {
            updateStatus(forDirection, { type: 'error', message: rampErrorMessage(tracked) || 'This M-Pesa order could not be completed.' })
          } else if (forDirection === 'deposit' && ['mpesa_paid', 'mpesa_confirmed', 'fiber_pending', 'fiber_sending', 'delivery_pending', 'settling', 'payment_pending'].includes(state)) {
            updateStage(forDirection, 'settling')
            updateStatus(forDirection, { type: 'warning', message: 'M-Pesa payment received. RUSD is settling over Fiber; keep this wallet tab open.' })
          } else if (forDirection === 'withdrawal' && ['fiber_paid', 'rusd_received', 'b2c_submitting', 'b2c_pending', 'payout_pending', 'payout_submitted', 'mpesa_pending', 'payout_unknown', 'payout_failed', 'refund_pending', 'refund_sending'].includes(state)) {
            updateStage(forDirection, 'payout')
            updateStatus(forDirection, {
              type: state === 'payout_unknown' ? 'error' : 'warning',
              message: state === 'payout_unknown'
                ? 'M-Pesa payout status is unknown. RUSD remains held while the payout is independently reconciled.'
                : ['payout_failed', 'refund_pending', 'refund_sending'].includes(state)
                 ? state === 'payout_failed'
                   ? 'M-Pesa payout did not complete. Create a refund request to return the RUSD to this wallet.'
                   : state === 'refund_sending'
                     ? 'Your RUSD refund is being sent. A stalled attempt can be resumed after its worker lease expires.'
                     : 'Your RUSD refund is processing.'
                : 'Fiber payment confirmed. Your M-Pesa payout is processing.',
            })
          }
        }
      } catch (error) {
        setActivityStatus({ type: 'warning', message: `M-Pesa status will retry automatically. ${errorMessage(error, 'Could not refresh orders.')}` })
      } finally {
        pollingOrders.current = false
      }
    }

    poll()
    const timer = setInterval(poll, 5000)
    return () => clearInterval(timer)
  }, [activeOrderIds])

  async function refreshOrders() {
    setRefreshingOrders(true)
    setActivityStatus(null)
    try {
      const result = await api('/ramp/orders')
      const nextOrders = result.orders || []
      setOrders(nextOrders)
      setCurrentOrders((current) => ({
        deposit: nextOrders.find((order) => order.id === current.deposit?.id)
          || nextOrders.find((order) => rampKind(order) === 'deposit' && isActiveRampOrder(order))
          || null,
        withdrawal: nextOrders.find((order) => order.id === current.withdrawal?.id)
          || nextOrders.find((order) => rampKind(order) === 'withdrawal' && isActiveRampOrder(order))
          || null,
      }))
    } catch (error) {
      setActivityStatus({ type: 'error', message: errorMessage(error, 'Could not refresh M-Pesa activity.') })
    } finally {
      setRefreshingOrders(false)
    }
  }

  async function requestQuote(event) {
    event.preventDefault()
    setLoadingDirection(direction)
    updateStage(direction, 'getting_quote')
    updateStatus(direction, null)
    if (direction === 'deposit') setRouteIssue(null)

    try {
      if (!config) throw new Error('M-Pesa configuration is still loading')
      if (direction === 'deposit' && !config.depositsEnabled) throw new Error('M-Pesa deposits are temporarily unavailable')
      if (direction === 'withdrawal' && !config.withdrawalsEnabled) {
        throw new Error('Cash-out is temporarily unavailable while M-Pesa payout credentials are being completed')
      }
      const kesAmount = validateKesAmount(amount)
      const result = await api('/ramp/quotes', {
        method: 'POST',
        body: JSON.stringify({ direction, kesAmount }),
      })
      const nextQuote = { ...result.quote, direction }
      setQuotes((current) => ({ ...current, [direction]: nextQuote }))
      setCurrentOrders((current) => ({
        ...current,
        [direction]: isActiveRampOrder(current[direction]) ? current[direction] : null,
      }))
      updateStage(direction, 'quoted')
      createIdempotencyKey(direction)
      updateStatus(direction, { type: 'success', message: `Quote ready for ${formatKes(nextQuote.kesAmount)}. Review the exact amounts before continuing.` })
      setNow(Date.now())
    } catch (error) {
      updateStage(direction, quote ? 'quoted' : 'amount')
      updateStatus(direction, { type: 'error', message: errorMessage(error, 'Could not create an M-Pesa quote.') })
    } finally {
      setLoadingDirection('')
    }
  }

  function operatorLiquidityError(result, requiredBaseUnits) {
    if (result?.nextAction !== 'fund_operator_rusd') return null
    const required = result.requiredOutboundLiquidity || requiredBaseUnits
    setRouteIssue({
      requiredBaseUnits: required,
      address: result.operatorFundingAddress || '',
    })
    return new Error(`The Dular operator needs ${formatRUsd(required)} of testnet RUSD liquidity before this deposit can continue. No M-Pesa prompt was started. Add RUSD to the operator address below, then resume the deposit.`)
  }

  async function prepareDepositRoute(requiredBaseUnits, rampOrderId) {
    updateStage('deposit', 'preparing_route')
    updateStatus('deposit', { type: 'warning', message: 'Preparing an exact RUSD receive route. Keep this wallet tab open while the channel is checked.' })
    let route = await requestReceiveRoute(nodeInfo.pubkey, nodeInfo.addresses || [], {
      fundingAmountBaseUnits: String(requiredBaseUnits),
      rampOrderId,
    })
    let liquidityError = operatorLiquidityError(route, requiredBaseUnits)
    if (liquidityError) throw liquidityError

    if (route.nextAction === 'accept_channel') {
      updateStatus('deposit', { type: 'warning', message: 'A receive channel reached this wallet. Approving it on this device now.' })
      let accepted
      try {
        accepted = await acceptPendingChannel(route)
      } catch (error) {
        if (!isMissingTempChannelError(error)) {
          throw new Error(`The receive channel could not be accepted. No M-Pesa prompt was started. ${errorMessage(error, 'Keep this wallet open and resume the deposit.')}`, { cause: error })
        }
        route = await requestReceiveRoute(nodeInfo.pubkey, nodeInfo.addresses || [], {
          replacePending: true,
          fundingAmountBaseUnits: String(requiredBaseUnits),
          rampOrderId,
        })
        liquidityError = operatorLiquidityError(route, requiredBaseUnits)
        if (liquidityError) throw liquidityError
        try {
          accepted = await acceptPendingChannel(route)
        } catch (retryError) {
          throw new Error(`The refreshed receive channel could not be accepted. No M-Pesa prompt was started. ${errorMessage(retryError, 'Keep this wallet open and resume the deposit.')}`, { cause: retryError })
        }
      }
      if (!accepted?.length) {
        throw new Error('No receive channel reached this wallet. No M-Pesa prompt was started. Keep the tab open, update the wallet, then resume the deposit.')
      }
      await onRefreshNetwork({ silent: true })
    }

    if (!route.readyChannel && !route.hopHints?.length) {
      updateStatus('deposit', { type: 'warning', message: 'Receive channel accepted. Waiting for the exact RUSD route to become ready.' })
      route = await retryReceiveRoute(nodeInfo.pubkey, nodeInfo.addresses || [], {
        fundingAmountBaseUnits: String(requiredBaseUnits),
        rampOrderId,
      })
      liquidityError = operatorLiquidityError(route, requiredBaseUnits)
      if (liquidityError) throw liquidityError
    }
    if (!route.readyChannel && !route.hopHints?.length) {
      throw new Error('The receive channel is not ready yet. No M-Pesa prompt was started. Keep this wallet tab open and resume the deposit shortly.')
    }
    setRouteIssue(null)
    return route
  }

  async function startDeposit() {
    if (!nodeInfo?.pubkey) throw new Error('The browser wallet is still starting. Wait for it to connect before depositing.')
    if (!config?.depositsEnabled) throw new Error('M-Pesa deposits are temporarily unavailable')
    if (!quote && !currentOrders.deposit) throw new Error('Request a deposit quote first')
    if (!currentOrders.deposit && quoteExpired) throw new Error('This quote expired. Request a new quote before paying.')

    let order = isActiveRampOrder(currentOrders.deposit) ? currentOrders.deposit : null
    if (!order) {
      updateStage('deposit', 'creating_order')
      updateStatus('deposit', { type: 'warning', message: 'Reserving this exact market quote before preparing the wallet receive route.' })
      const result = await api('/ramp/deposits', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKeys.current.deposit || createIdempotencyKey('deposit') },
        body: JSON.stringify({ quoteId: quote.id }),
      })
      order = result.order
      updateCurrentOrder('deposit', order)
    }

    if (!rampBrowserInvoice(order)) {
      const requiredBaseUnits = order.rusdAmountBaseUnits || quote?.rusdAmountBaseUnits
      await prepareDepositRoute(requiredBaseUnits, order.id)
      updateStage('deposit', 'creating_invoice')
      updateStatus('deposit', { type: 'warning', message: `Creating an exact ${formatRUsd(requiredBaseUnits)} invoice for this deposit.` })
      const invoice = await browserCreateInvoice({
        amountHex: baseUnitsHex(requiredBaseUnits),
        description: `Dular deposit ${order.id}`,
      })
      if (!invoice?.invoice_address) throw new Error('The browser wallet did not return a Fiber invoice')
      const attached = await api(`/ramp/deposits/${order.id}/invoice`, {
        method: 'PUT',
        body: JSON.stringify({ invoice: invoice.invoice_address }),
      })
      order = attached.order
      updateCurrentOrder('deposit', order)
    }

    if (!order.checkoutRequestId && rampStateName(order) !== 'completed') {
      updateStage('deposit', 'starting_stk')
      updateStatus('deposit', { type: 'warning', message: `Starting the M-Pesa prompt for exactly ${formatKes(order.kesAmount)}. Keep this wallet tab open.` })
      const started = await api(`/ramp/deposits/${order.id}/stk`, { method: 'POST' })
      order = started.order
      updateCurrentOrder('deposit', order)
    }

    if (rampStateName(order) === 'completed') {
      updateStage('deposit', 'completed')
      updateStatus('deposit', { type: 'success', message: `${formatRUsd(order.rusdAmountBaseUnits)} is now settled in this wallet.` })
    } else if (rampStateName(order) === 'mpesa_failed') {
      throw new Error(rampErrorMessage(order) || 'The M-Pesa prompt was rejected before payment')
    } else if (rampStateName(order) === 'mpesa_unknown' && !order.checkoutRequestId) {
      updateStage('deposit', 'awaiting_mpesa')
      updateStatus('deposit', { type: 'error', message: 'The M-Pesa prompt submission status is unknown. Do not create another deposit; this order requires reconciliation.' })
    } else {
      updateStage('deposit', 'awaiting_mpesa')
      updateStatus('deposit', { type: 'warning', message: `Check your phone and approve exactly ${formatKes(order.kesAmount)}. Keep this wallet tab open until the order is completed and RUSD is settled.` })
    }
  }

  async function startWithdrawal() {
    if (!config?.withdrawalsEnabled) {
      throw new Error('Cash-out is temporarily unavailable while M-Pesa payout credentials are being completed')
    }
    if (!operatorPubkey) throw new Error('The Dular operator is not connected yet. Update the wallet and try again.')
    if (!quote && !currentOrders.withdrawal) throw new Error('Request a cash-out quote first')
    if (!currentOrders.withdrawal && quoteExpired) throw new Error('This quote expired. Request a new quote before cashing out.')

    let order = isActiveRampOrder(currentOrders.withdrawal) ? currentOrders.withdrawal : null
    if (!order) {
      updateStage('withdrawal', 'creating_order')
      updateStatus('withdrawal', { type: 'warning', message: 'Creating the cash-out order and requesting the operator invoice.' })
      const result = await api('/ramp/withdrawals', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKeys.current.withdrawal || createIdempotencyKey('withdrawal') },
        body: JSON.stringify({ quoteId: quote.id }),
      })
      order = result.order
      updateCurrentOrder('withdrawal', order)
    }

    const withdrawalState = rampStateName(order)
    if (withdrawalState === 'completed') {
      updateStage('withdrawal', 'completed')
      updateStatus('withdrawal', { type: 'success', message: `${formatKes(order.kesAmount)} was sent to your M-Pesa account.` })
      return
    }
    if (withdrawalState !== 'awaiting_rusd' || rampPaymentHash(order)) {
      updateStage('withdrawal', 'payout')
      updateStatus('withdrawal', {
        type: withdrawalState === 'payout_unknown' ? 'error' : 'warning',
        message: withdrawalState === 'payout_unknown'
          ? 'M-Pesa payout status is unknown. RUSD is held while the payout is independently reconciled; do not submit another cash-out.'
          : 'Fiber payment is confirmed and the M-Pesa payout is processing.',
      })
      return
    }

    const operatorInvoice = rampOperatorInvoice(order)
    if (!operatorInvoice) throw new Error('The M-Pesa operator did not return a Fiber invoice. No wallet payment was sent.')
    const expectedAmount = quote?.rusdAmountBaseUnits || order.rusdAmountBaseUnits
    if (!expectedAmount) throw new Error('This quote is missing the exact cash-out debit amount. No wallet payment was sent.')

    updateStage('withdrawal', 'validating_invoice')
    updateStatus('withdrawal', { type: 'warning', message: 'Validating the operator, exact amount, Fiber network, and RUSD asset before payment.' })
    await validateOperatorInvoice({
      invoiceAddress: operatorInvoice,
      operatorPubkey,
      expectedAmountBaseUnits: expectedAmount,
      expectedDescription: `Dular withdrawal ${order.id}`,
      expectedPaymentHash: order.invoicePaymentHash,
    })

    let paymentHash = rampPaymentHash(order) || order.invoicePaymentHash
    if (!paymentHash) throw new Error('The verified cash-out invoice has no payment hash')
    let payment = null
    if (!rampPaymentHash(order)) {
      try {
        payment = await browserGetPayment(paymentHash)
      } catch (error) {
        if (!isPaymentNotFoundError(error)) {
          throw new Error(`Could not verify whether this cash-out was already sent: ${error.message || 'wallet lookup failed'}`, { cause: error })
        }
      }
    }

    if (!rampPaymentHash(order) && !payment) {
      const latestChannels = await browserListChannels()
      const spendable = sumChannelBalance((latestChannels.channels || []).filter(isReadyChannel))
      if (spendable < BigInt(String(expectedAmount))) {
        throw new Error(`This wallet has ${formatRUsd(spendable)} spendable, but the verified cash-out invoice requires exactly ${formatRUsd(expectedAmount)}.`)
      }
      updateStage('withdrawal', 'sending_fiber')
      updateStatus('withdrawal', { type: 'warning', message: `Invoice verified. Sending exactly ${formatRUsd(expectedAmount)} from this browser wallet.` })
      payment = await browserSendPayment(operatorInvoice)
      if (isFailedPaymentStatus(paymentStatusName(payment))) {
        throw new Error(payment.failed_error || `Fiber payment failed with status ${paymentStatusName(payment)}`)
      }
      if (payment.payment_hash && payment.payment_hash.toLowerCase() !== paymentHash.toLowerCase()) {
        throw new Error('Fiber returned a different payment hash for the verified cash-out invoice')
      }
      await onRefreshNetwork({ silent: true })
    }

    if (!rampPaymentHash(order)) {
      updateStage('withdrawal', 'confirming_fiber')
      updateStatus('withdrawal', { type: 'warning', message: 'Fiber payment submitted. Waiting for finality before M-Pesa payout.' })
      const finalPayment = paymentStatusName(payment) === 'Success'
        ? { final: true, payment }
        : await waitForPaymentFinality(paymentHash, () => {})
      if (!finalPayment.final) {
        throw new Error(`Fiber payment is still ${paymentStatusName(finalPayment.payment)}. It will be resumed by payment hash and must not be sent again.`)
      }
      const confirmed = await api(`/ramp/withdrawals/${order.id}/confirm-fiber`, {
        method: 'POST',
        body: JSON.stringify({ paymentHash }),
      })
      order = confirmed.order
      updateCurrentOrder('withdrawal', order)
    }

    if (rampStateName(order) === 'completed') {
      updateStage('withdrawal', 'completed')
      updateStatus('withdrawal', { type: 'success', message: `${formatKes(order.kesAmount)} was sent to your M-Pesa account.` })
    } else {
      updateStage('withdrawal', 'payout')
      updateStatus('withdrawal', { type: 'warning', message: 'Fiber payment was submitted. M-Pesa payout will start after confirmation; keep this wallet tab open until the order is completed.' })
    }
  }

  async function requestWithdrawalRefund() {
    let order = currentOrders.withdrawal
    const staleRefundSend = rampStateName(order) === 'refund_sending'
      && new Date(order.updatedAt).getTime() <= Date.now() - 600_000
    if (!order || (!['payout_failed', 'refund_pending'].includes(rampStateName(order)) && !staleRefundSend)) {
      throw new Error('This cash-out is not awaiting an RUSD refund')
    }

    updateStage('withdrawal', 'refund')
    updateStatus('withdrawal', { type: 'warning', message: 'Preparing an exact RUSD refund request for this browser wallet.' })
    let refundInvoice = order.refundInvoice || ''
    if (order.refundInvoiceExpiresAt && new Date(order.refundInvoiceExpiresAt).getTime() <= Date.now()) {
      refundInvoice = ''
    }
    if (!refundInvoice) {
      const invoice = await browserCreateInvoice({
        amountHex: baseUnitsHex(order.rusdAmountBaseUnits),
        description: `Dular refund ${order.id}`,
      })
      refundInvoice = invoice?.invoice_address || ''
    }
    if (!refundInvoice) throw new Error('The browser wallet could not create the refund invoice')

    const result = await api(`/ramp/withdrawals/${order.id}/refund-invoice`, {
      method: 'PUT',
      body: JSON.stringify({ invoice: refundInvoice }),
    })
    order = result.order
    updateCurrentOrder('withdrawal', order)
    if (rampStateName(order) === 'refunded') {
      updateStage('withdrawal', 'completed')
      updateStatus('withdrawal', { type: 'success', message: `${formatRUsd(order.rusdAmountBaseUnits)} was refunded to this wallet.` })
      await onRefreshNetwork({ silent: true })
    } else {
      updateStatus('withdrawal', { type: 'warning', message: rampErrorMessage(order) || 'The refund is pending. Keep this wallet open and retry shortly.' })
    }
  }

  async function continueWorkflow() {
    setLoadingDirection(direction)
    updateStatus(direction, null)
    try {
      if (direction === 'deposit') await startDeposit()
      else await startWithdrawal()
    } catch (error) {
      updateStatus(direction, { type: 'error', message: errorMessage(error, `Could not complete the M-Pesa ${direction}.`) })
    } finally {
      setLoadingDirection('')
    }
  }

  async function continueRefund() {
    setLoadingDirection('withdrawal')
    try {
      await requestWithdrawalRefund()
    } catch (error) {
      updateStatus('withdrawal', { type: 'error', message: errorMessage(error, 'Could not request the RUSD refund.') })
    } finally {
      setLoadingDirection('')
    }
  }

  const unavailableCopy = direction === 'withdrawal' && config && !config.withdrawalsEnabled
    ? 'Cash-out is temporarily unavailable while M-Pesa payout credentials are being completed'
    : direction === 'deposit' && config && !config.depositsEnabled
      ? 'M-Pesa deposits are temporarily unavailable'
      : ''
  const staleRefundSend = direction === 'withdrawal'
    && rampStateName(currentOrder) === 'refund_sending'
    && new Date(currentOrder?.updatedAt).getTime() <= now - 600_000
  const refundState = direction === 'withdrawal'
    && (['payout_failed', 'refund_pending'].includes(rampStateName(currentOrder)) || staleRefundSend)
  const resumableOrder = direction === 'deposit'
    ? isActiveRampOrder(currentOrder)
    : rampStateName(currentOrder) === 'awaiting_rusd'
  const canContinue = Boolean(resumableOrder || (quote && !currentOrder))
    && !loading
    && !unavailableCopy
    && !refundState
    && (!quoteExpired || isActiveRampOrder(currentOrder))
    && (direction === 'deposit' ? Boolean(nodeInfo?.pubkey) : Boolean(operatorPubkey))

  return (
    <>
      <section className="flowHero mpesaHero">
        <div>
          <p className="eyebrow">M-Pesa · {config?.network || 'testnet'}</p>
          <h1>Move between KES and RUSD</h1>
          <p>Use a live quote, then keep this wallet open while M-Pesa and Fiber settle.</p>
        </div>
        <div className="rampSegmented" role="group" aria-label="M-Pesa transaction type">
          <button type="button" className={direction === 'deposit' ? 'active' : ''} aria-pressed={direction === 'deposit'} onClick={() => setDirection('deposit')} disabled={Boolean(loadingDirection)}>
            <ArrowDownLeft size={16} /> Deposit
          </button>
          <button type="button" className={direction === 'withdrawal' ? 'active' : ''} aria-pressed={direction === 'withdrawal'} onClick={() => setDirection('withdrawal')} disabled={Boolean(loadingDirection)}>
            <ArrowUpRight size={16} /> Cash out
          </button>
        </div>
      </section>

      <section className="contentCard mpesaRampCard" aria-labelledby="mpesa-ramp-title">
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">{direction === 'deposit' ? 'M-Pesa to wallet' : 'Wallet to M-Pesa'}</p>
            <h2 id="mpesa-ramp-title">{direction === 'deposit' ? 'Deposit KES' : 'Cash out RUSD'}</h2>
          </div>
          {config && <span className="safePill">{config.asset} · {config.environment}</span>}
        </div>

        {unavailableCopy && (
          <div className="rampAvailability" role="status">
            <Clock3 size={18} aria-hidden="true" />
            <span>{unavailableCopy}</span>
          </div>
        )}
        {loadingConfig && <div className="rampLoading" role="status"><RefreshCw size={17} className="spin" /> Loading M-Pesa availability...</div>}
        <Status state={configStatus} />

        <form onSubmit={requestQuote} className="rampAmountForm">
          <div className="formGroup">
            <label htmlFor={`mpesa-${direction}-amount`}>{direction === 'deposit' ? 'Amount to pay with M-Pesa' : 'Amount to receive on M-Pesa'}</label>
            <div className="amountField">
              <input
                id={`mpesa-${direction}-amount`}
                value={amount}
                onChange={(event) => setAmounts((current) => ({ ...current, [direction]: event.target.value }))}
                inputMode="decimal"
                min={config?.minKes}
                max={config?.maxKes}
                step="1"
                placeholder={config?.minKes ? String(config.minKes) : '500'}
                aria-describedby="mpesa-amount-limits"
                disabled={loading || Boolean(unavailableCopy) || isActiveRampOrder(currentOrder)}
                required
              />
              <span>KES</span>
            </div>
            <p className="inputHint" id="mpesa-amount-limits">
              {config ? `${formatKes(config.minKes)} minimum · ${formatKes(config.maxKes)} maximum · ${(Number(config.feeBps || 0) / 100).toFixed(2)}% fee` : 'Loading limits...'}
            </p>
          </div>
          <button type="submit" className="secondaryBtn fullWidth" disabled={loading || loadingConfig || Boolean(unavailableCopy) || isActiveRampOrder(currentOrder)}>
            {loading && stage === 'getting_quote' ? 'Getting quote...' : quote ? 'Refresh quote' : 'Get quote'}
          </button>
        </form>

        {quote && (
          <div className="rampQuote" aria-label="M-Pesa quote">
            <div className="rampQuoteHeading">
              <strong>Quote</strong>
              <span className={quoteExpired ? 'expired' : ''}>
                <Clock3 size={14} /> {quoteExpired ? 'Expired' : `${quoteSecondsLeft}s remaining`}
              </span>
            </div>
            <dl className="quoteSummary">
              {direction === 'deposit' ? (
                <>
                  <div><dt>You pay</dt><dd>{formatKes(quote.kesAmount)}</dd></div>
                  <div><dt>Gross RUSD</dt><dd>{formatRUsd(quote.grossRUsdBaseUnits)}</dd></div>
                  <div><dt>Fee</dt><dd>{formatRUsd(quote.feeRUsdBaseUnits)}</dd></div>
                  <div className="quoteTotal"><dt>Your wallet receives</dt><dd>{formatRUsd(quote.rusdAmountBaseUnits)}</dd></div>
                </>
              ) : (
                <>
                  <div><dt>Your wallet sends</dt><dd>{formatRUsd(quote.rusdAmountBaseUnits)}</dd></div>
                  <div><dt>Fee</dt><dd>{formatRUsd(quote.feeRUsdBaseUnits)}</dd></div>
                  <div><dt>RUSD value</dt><dd>{formatRUsd(quote.grossRUsdBaseUnits)}</dd></div>
                  <div className="quoteTotal"><dt>M-Pesa receives</dt><dd>{formatKes(quote.kesAmount)}</dd></div>
                </>
              )}
              <div><dt>Rate</dt><dd>{formatKes(Number(quote.rateKesPerRUsdMicros || 0) / 1_000_000)} / RUSD</dd></div>
            </dl>
          </div>
        )}

        {(quote || currentOrder) && <RampProgress direction={direction} stage={stage} order={currentOrder} />}

        {routeIssue && direction === 'deposit' && (
          <div className="rampRouteIssue">
            <p className="eyebrow">Operator liquidity required</p>
            <strong>Add {formatRUsd(routeIssue.requiredBaseUnits)} testnet RUSD</strong>
            <p>Send RUSD to the operator address, not CKB, then resume this deposit. No M-Pesa prompt has started.</p>
            <div className="buttonRow wrapButtons">
              <a className="secondaryBtn" href={RUSD_TESTNET_FAUCET_URL} target="_blank" rel="noreferrer">RUSD faucet <ExternalLink size={15} /></a>
              <CopyButton value={routeIssue.address} label="Copy operator address" />
            </div>
          </div>
        )}

        <Status state={status} />
        {canContinue && rampStateName(currentOrder) !== 'completed' && (
          <button type="button" className="primaryBtn fullWidth rampSubmitBtn" onClick={continueWorkflow} disabled={!canContinue}>
            {loading
              ? direction === 'deposit' ? 'Preparing deposit...' : 'Preparing cash-out...'
              : isActiveRampOrder(currentOrder)
                ? `Resume ${direction === 'deposit' ? 'deposit' : 'cash-out'}`
                : direction === 'deposit'
                  ? `Pay ${formatKes(quote.kesAmount)} with M-Pesa`
                  : `Cash out ${formatKes(quote.kesAmount)}`}
          </button>
        )}
        {refundState && (
          <button type="button" className="primaryBtn fullWidth rampSubmitBtn" onClick={continueRefund} disabled={loading}>
            {loading ? 'Requesting refund...' : currentOrder?.refundInvoice ? 'Retry RUSD refund' : 'Create RUSD refund'}
          </button>
        )}
        {currentOrder && (
          <details className="rampTechnical rampCurrentDetails">
            <summary>Current order details</summary>
            <div>
              <ProofRow label="Order" value={currentOrder.id} />
              <ProofRow label="State" value={currentOrder.state || currentOrder.status || 'Unknown'} />
              <ProofRow label="KES amount" value={formatKes(currentOrder.kesAmount)} />
              <ProofRow label="RUSD amount" value={formatRUsd(currentOrder.rusdAmountBaseUnits)} />
              {currentOrder.checkoutRequestId && <ProofRow label="M-Pesa checkout" value={currentOrder.checkoutRequestId} />}
              {rampPaymentHash(currentOrder) && <ProofRow label="Fiber payment" value={rampPaymentHash(currentOrder)} />}
            </div>
          </details>
        )}
      </section>

      <section className="contentCard rampActivity" aria-labelledby="ramp-activity-title">
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">History</p>
            <h2 id="ramp-activity-title">Recent M-Pesa activity</h2>
          </div>
          <button type="button" className="ghostBtn" onClick={refreshOrders} disabled={refreshingOrders} aria-label="Refresh M-Pesa activity">
            <RefreshCw size={16} className={refreshingOrders ? 'spin' : ''} /> {refreshingOrders ? 'Updating' : 'Refresh'}
          </button>
        </div>
        <Status state={activityStatus} />
        {orders.length ? (
          <div className="rampOrderList">
            {orders.map((order) => <RampOrderItem order={order} key={order.id} />)}
          </div>
        ) : (
          <div className="emptyState">
            <Smartphone size={28} aria-hidden="true" />
            <strong>No M-Pesa activity yet</strong>
            <span>Your deposits and cash-outs will appear here.</span>
          </div>
        )}
      </section>
    </>
  )
}

function RampProgress({ direction, stage, order }) {
  const steps = direction === 'deposit'
    ? ['Quote', 'Receive route', 'M-Pesa', 'RUSD settled']
    : ['Quote', 'Verify invoice', 'Fiber payment', 'M-Pesa payout']
  const stageIndexes = direction === 'deposit'
    ? {
        amount: 0,
        getting_quote: 0,
        quoted: 0,
        creating_order: 1,
        preparing_route: 1,
        creating_invoice: 1,
        starting_stk: 2,
        awaiting_mpesa: 2,
        settling: 3,
        completed: 3,
      }
    : {
        amount: 0,
        getting_quote: 0,
        quoted: 0,
        creating_order: 1,
        validating_invoice: 1,
        sending_fiber: 2,
        confirming_fiber: 2,
         payout: 3,
         refund: 3,
        completed: 3,
      }
  const completed = rampStateName(order) === 'completed'
  const activeIndex = stageIndexes[stage] ?? 0

  return (
    <ol className="rampProgress" aria-label={`${direction === 'deposit' ? 'Deposit' : 'Cash-out'} progress`}>
      {steps.map((label, index) => (
        <li className={completed || index < activeIndex ? 'done' : index === activeIndex ? 'current' : ''} aria-current={!completed && index === activeIndex ? 'step' : undefined} key={label}>
          <span>{completed || index < activeIndex ? <Check size={14} /> : index + 1}</span>
          <strong>{label}</strong>
        </li>
      ))}
    </ol>
  )
}

function RampOrderItem({ order }) {
  const kind = rampKind(order)
  const stateInfo = rampStateInfo(order)
  const Icon = kind === 'deposit' ? ArrowDownLeft : ArrowUpRight
  const timestamp = order.createdAt ? new Date(order.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Time unavailable'

  return (
    <article className={`rampOrderItem ${stateInfo.tone}`}>
      <div className="activityIcon"><Icon size={18} aria-hidden="true" /></div>
      <div className="activityBody">
        <div className="activityTop">
          <div>
            <strong>{kind === 'deposit' ? 'M-Pesa deposit' : 'M-Pesa cash-out'}</strong>
            <p>{stateInfo.label}</p>
          </div>
          <div className="activityAmount">
            <strong>{formatKes(order.kesAmount)}</strong>
            <span>{kind === 'deposit' ? '+' : '-'}{formatRUsd(order.rusdAmountBaseUnits)}</span>
          </div>
        </div>
        <div className="activityMeta">
          <span>{timestamp}</span>
          {order.receiptNumber && <span>M-Pesa receipt {order.receiptNumber}</span>}
        </div>
        <details className="rampTechnical">
          <summary>Technical details</summary>
          <div>
            <ProofRow label="Order ID" value={order.id} />
            <ProofRow label="Direction" value={kind} />
            <ProofRow label="State" value={order.state || order.status || 'Unknown'} />
            {rampBrowserInvoice(order) && <ProofRow label="Browser invoice" value={rampBrowserInvoice(order)} />}
            {rampOperatorInvoice(order) && <ProofRow label="Operator invoice" value={rampOperatorInvoice(order)} />}
            {rampPaymentHash(order) && <ProofRow label="Fiber payment" value={rampPaymentHash(order)} />}
            {order.fiberStatus && <ProofRow label="Fiber status" value={order.fiberStatus} />}
            {order.checkoutRequestId && <ProofRow label="M-Pesa checkout" value={order.checkoutRequestId} />}
            {order.receiptNumber && <ProofRow label="M-Pesa receipt" value={order.receiptNumber} />}
            {rampErrorMessage(order) && <ProofRow label="Error" value={rampErrorMessage(order)} />}
            {order.updatedAt && <ProofRow label="Last updated" value={new Date(order.updatedAt).toLocaleString()} />}
          </div>
        </details>
      </div>
    </article>
  )
}

function BetaFlowCard({ phase }) {
  const steps = [
    {
      key: 'fund',
      title: 'Add testnet funds',
      text: 'Use the CKB and RUSD faucets.',
    },
    {
      key: 'activate',
      title: 'Make RUSD spendable',
      text: 'Move on-chain RUSD into a Fiber channel.',
    },
    {
      key: 'ready',
      title: 'Make a payment',
      text: 'Send or receive RUSD from another wallet.',
    },
  ]
  const phaseIndex = steps.findIndex((step) => step.key === phase)

  return (
    <section className="contentCard betaFlowCard">
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">Wallet setup</p>
          <h2>Payment readiness</h2>
        </div>
      </div>
      <div className="betaSteps">
        {steps.map((step, index) => {
          const state = index < phaseIndex ? 'done' : index === phaseIndex ? 'active' : 'locked'
          return (
            <div className={`betaStep ${state}`} key={step.key}>
              <span>{index + 1}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.text}</p>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function FundingAddressCard({ walletAddress, funding, onRefreshNetwork, refreshingNetwork }) {
  return (
    <div className="fundingAddressCard">
      <div>
        <span>Your wallet address</span>
        <code>{walletAddress || 'Starting wallet...'}</code>
      </div>
      <div className="buttonRow wrapButtons">
        {walletAddress && <CopyButton value={walletAddress} label="Copy address" />}
        <a className="secondaryBtn" href={CKB_TESTNET_FAUCET_URL} target="_blank" rel="noreferrer">
          CKB faucet <ExternalLink size={15} />
        </a>
        <a className="secondaryBtn" href={RUSD_TESTNET_FAUCET_URL} target="_blank" rel="noreferrer">
          RUSD faucet <ExternalLink size={15} />
        </a>
        <button type="button" className="ghostBtn" onClick={() => onRefreshNetwork()} disabled={refreshingNetwork}>
          <RefreshCw size={16} className={refreshingNetwork ? 'spin' : ''} /> {refreshingNetwork ? 'Checking balance' : 'Check faucet balance'}
        </button>
      </div>
      <div className="fundingMetrics">
        <div>
          <span>On-chain CKB</span>
          <strong>{funding?.capacity || '0 CKB'}</strong>
        </div>
        <div>
          <span>On-chain RUSD</span>
          <strong>{funding?.rusdBaseUnits ? formatRUsd(funding.rusdBaseUnits) : '0 RUSD'}</strong>
        </div>
      </div>
    </div>
  )
}

function TopUpCard({ nodeInfo, walletAddress, funding, operatorInfo, onRefreshNetwork }) {
  const [amount, setAmount] = useState('1.00')
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [proof, setProof] = useState(null)
  const operatorPubkey = operatorInfo?.operator?.pubkey || ''
  const operatorAutoAcceptMinimum = operatorRUsdAutoAcceptBaseUnits(operatorInfo)
  const fundedPendingChannel = proof?.fundedPendingChannel || proof?.pendingChannels?.find((channel) => channel.channel_outpoint)
  const canClearTemporaryChannel = (proof?.opened?.temporary_channel_id || proof?.pendingChannels?.length > 0)
    && !proof?.readyChannel
    && !fundedPendingChannel
    && !proof?.temporaryChannelMissing
  const detectedRUsd = funding?.rusdBaseUnits ? formatRUsd(funding.rusdBaseUnits) : '0 RUSD'

  async function submit(event) {
    event.preventDefault()
    if (!nodeInfo?.pubkey) {
      setStatus({ type: 'error', message: 'Wallet is still starting. Wait a few seconds and try again.' })
      return
    }
    if (!operatorPubkey) {
      setStatus({ type: 'error', message: 'Dular operator is not connected yet. Update the wallet and try again.' })
      return
    }

    setLoading(true)
    setStatus(null)
    setProof(null)

    try {
      const fundingAmountBaseUnits = toBaseUnits(amount)
      setStatus({ type: 'warning', message: 'Checking faucet funds on your wallet address...' })
      const lockArg = getFundingLockArg(nodeInfo)
      const latestFunding = lockArg
        ? await api('/fiber/browser/address', {
          method: 'POST',
          body: JSON.stringify({ lockArg }),
        })
        : funding
      const walletRUsdBaseUnits = BigInt(String(latestFunding?.rusdBaseUnits || 0))
      setProof({
        walletCapacity: latestFunding?.capacity,
        walletRUsdBaseUnits: latestFunding?.rusdBaseUnits || '0',
        operatorPubkey,
        requestedAmountBaseUnits: fundingAmountBaseUnits.toString(),
      })
      if (walletRUsdBaseUnits < fundingAmountBaseUnits) {
        throw new Error(`This wallet only has ${formatRUsd(walletRUsdBaseUnits)} on-chain. Fund at least ${formatRUsd(fundingAmountBaseUnits)} RUSD to your wallet address first.`)
      }

      setStatus({ type: 'warning', message: 'Opening a self-funded Fiber channel from this browser wallet...' })
      const operatorStatus = await api('/fiber/operator')
      const operatorCapacity = BigInt(String(operatorStatus.ckbCapacityShannons || '0'))
      const currentOperatorMinimum = operatorRUsdAutoAcceptBaseUnits(operatorStatus)
      setProof((current) => ({
        ...(current || {}),
        operatorFundingAddress: operatorStatus.fundingAddress,
        operatorCkbCapacity: operatorStatus.ckbCapacity,
        operatorCkbCapacityShannons: operatorStatus.ckbCapacityShannons,
        operatorAutoAcceptMinimum: currentOperatorMinimum.toString(),
      }))
      if (operatorCapacity < MIN_OPERATOR_CHANNEL_CAPACITY) {
        throw new Error(`Dular operator needs testnet CKB capacity before it can accept this channel. Current operator balance is ${operatorStatus.ckbCapacity}. Send at least 200 CKB to ${operatorStatus.fundingAddress}, update the wallet, then retry.`)
      }
      if (currentOperatorMinimum > 0n && fundingAmountBaseUnits < currentOperatorMinimum) {
        throw new Error(`Minimum self-funded channel amount is ${formatRUsd(currentOperatorMinimum)} on the current operator node. Add more RUSD or retry with at least that amount.`)
      }
      const clearedOperatorChannels = await requestClearOperatorStale(nodeInfo.pubkey)
      const clearedChannels = await clearStaleOperatorChannels(operatorPubkey)
      const opened = await browserOpenRUsdChannel({
        pubkey: operatorPubkey,
        amountHex: toBaseUnitsHex(amount),
        isPublic: true,
      })
      const openedAt = Date.now()
      setProof((current) => ({ ...(current || {}), opened, openedAt, clearedChannels, clearedOperatorChannels }))
      const initialDiagnostics = await collectSelfChannelDiagnostics({
        browserPubkey: nodeInfo.pubkey,
        operatorPubkey,
        temporaryChannelId: opened.temporary_channel_id,
        openedAt,
      })
      setProof((current) => ({ ...(current || {}), ...initialDiagnostics }))

      setStatus({ type: 'warning', message: 'Channel funding started. Keep this tab open while CKB confirms the channel.' })
      const ready = await waitForSelfFundedChannel(nodeInfo.pubkey, operatorPubkey, fundingAmountBaseUnits, opened.temporary_channel_id, openedAt, (snapshot) => {
        setProof((current) => ({ ...(current || {}), ...snapshot }))
      })
      if (ready.failure) {
        throw new Error(`Fiber stopped the channel before broadcasting its funding transaction: ${ready.failure}. The failed temporary record is already closed; retry activation.`)
      }
      let finalChannels = await browserListChannels()
      let finalRoute = findSenderRouteChannel(finalChannels, operatorPubkey, fundingAmountBaseUnits)
      let finalChannel = ready.channel || finalRoute.channel

      if (finalChannel?.channel_id) {
        try {
          await browserUpdateChannel({ channelId: finalChannel.channel_id, tlcFeeProportionalMillionths: '0x0' })
        } catch {
          // The channel can still be usable if fee update races with readiness.
        }
      }
      await onRefreshNetwork({ silent: true })
      finalChannels = await browserListChannels()
      finalRoute = findSenderRouteChannel(finalChannels, operatorPubkey, fundingAmountBaseUnits)
      finalChannel = finalChannel || finalRoute.channel
      const finalPendingChannels = pendingOperatorChannels(finalChannels, operatorPubkey)
      const finalFundedPending = finalPendingChannels.find((channel) => channel.channel_outpoint)
      const finalDiagnostics = await collectSelfChannelDiagnostics({
        browserPubkey: nodeInfo.pubkey,
        operatorPubkey,
        temporaryChannelId: opened.temporary_channel_id,
        openedAt,
      })
      setProof((current) => ({
        ...(current || {}),
        ...finalDiagnostics,
        readyChannel: finalChannel || current?.readyChannel,
        latestLocalBalance: finalRoute.largestLocalBalance.toString(),
        pendingChannels: finalChannel ? [] : finalPendingChannels,
        senderRouteDiagnostics: describeSenderRouteChannels(finalChannels, operatorPubkey),
      }))
      setStatus({
        type: finalChannel ? 'success' : 'warning',
        message: finalChannel
          ? `${formatRUsd(fundingAmountBaseUnits)} self-funded channel is ready. You can now send from this wallet.`
          : finalFundedPending
            ? 'The funding transaction is visible on-chain. Keep this tab open and update the wallet shortly; the channel should become ready after CKB confirmation.'
            : 'The self-funded channel is still negotiating and no funding outpoint is visible yet. Clear the temporary channel and retry if this does not change.',
      })
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Could not open self-funded channel.' })
    } finally {
      setLoading(false)
    }
  }

  async function clearTemporaryChannel() {
    const channelId = proof?.opened?.temporary_channel_id || proof?.pendingChannels?.[0]?.channel_id
    if (!channelId) return
    setLoading(true)
    setStatus({ type: 'warning', message: 'Clearing temporary channel...' })
    try {
      await browserAbandonChannel(channelId)
      await onRefreshNetwork({ silent: true })
      setProof((current) => ({ ...(current || {}), clearedManually: channelId, opened: null }))
      setStatus({ type: 'success', message: 'Temporary channel cleared. You can retry opening a self-funded channel.' })
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Could not clear temporary channel.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="topUpPanel">
      <div className="activationCard">
        <div>
          <p className="eyebrow">Step 2 · Fiber channel</p>
          <h3>Make RUSD spendable</h3>
          <p>
            Move the amount you want to spend from your on-chain balance into a Fiber payment channel.
          </p>
        </div>
        <form onSubmit={submit}>
          <div className="formGroup">
            <label htmlFor="activation-amount">Amount to make spendable</label>
            <div className="amountField">
              <input id="activation-amount" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="1.00" required />
              <span>RUSD</span>
            </div>
            <p className="inputHint">Detected on-chain: {detectedRUsd}</p>
          </div>
          <button type="submit" className="primaryBtn fullWidth" disabled={loading || !nodeInfo?.pubkey}>
            {loading ? 'Opening Fiber channel...' : 'Make RUSD spendable'}
          </button>
        </form>
        <ProofDrawer summary="Activation details">
          <ProofRow label="Your CKB/RUSD address" value={walletAddress || 'Loading...'} />
          <ProofRow label="On-chain CKB" value={funding?.capacity || 'Update after funding'} />
          <ProofRow label="On-chain RUSD" value={funding?.rusdBaseUnits ? formatRUsd(funding.rusdBaseUnits) : 'Update after funding'} />
          <ProofRow label="Channel peer" value={operatorPubkey || 'Connecting'} />
          <ProofRow label="Operator CKB address" value={operatorInfo?.fundingAddress || 'Update to load'} />
          <ProofRow label="Operator CKB capacity" value={operatorInfo?.ckbCapacity || 'Update to load'} />
          <ProofRow label="Minimum channel" value={operatorAutoAcceptMinimum > 0n ? formatRUsd(operatorAutoAcceptMinimum) : 'Update to load'} />
        </ProofDrawer>
      </div>
      <Status state={proof?.temporaryChannelMissing || proof?.browserTemporaryChannelFailure || proof?.operatorTemporaryChannelFailure
        ? { type: 'error', message: `Fiber stopped this channel before broadcasting a funding transaction${proof?.browserTemporaryChannelFailure || proof?.operatorTemporaryChannelFailure ? `: ${proof.browserTemporaryChannelFailure || proof.operatorTemporaryChannelFailure}` : ''}. The temporary record is already closed; retry activation.` }
        : status} />
      {proof && (
        <ProofDrawer summary="Channel technical log">
          {proof.opened?.temporary_channel_id && <ProofRow label="Temporary channel" value={proof.opened.temporary_channel_id} />}
          {proof.readyChannel?.channel_id && <ProofRow label="Ready channel" value={proof.readyChannel.channel_id} />}
          {proof.readyChannel?.channel_outpoint && <ProofRow label="Funding outpoint" value={proof.readyChannel.channel_outpoint} />}
          {fundedPendingChannel?.channel_outpoint && <ProofRow label="Funding transaction" value={fundedPendingChannel.channel_outpoint} />}
          {proof.requestedAmountBaseUnits && <ProofRow label="Requested amount" value={formatRUsd(proof.requestedAmountBaseUnits)} />}
          {proof.walletCapacity && <ProofRow label="Detected CKB" value={proof.walletCapacity} />}
          {proof.walletRUsdBaseUnits && <ProofRow label="Detected RUSD" value={formatRUsd(proof.walletRUsdBaseUnits)} />}
          {proof.operatorFundingAddress && <ProofRow label="Operator CKB address" value={proof.operatorFundingAddress} />}
          {proof.operatorCkbCapacity && <ProofRow label="Operator CKB capacity" value={proof.operatorCkbCapacity} />}
          {proof.operatorAutoAcceptMinimum && <ProofRow label="Minimum channel" value={formatRUsd(proof.operatorAutoAcceptMinimum)} />}
          {proof.latestLocalBalance && <ProofRow label="Spendable in channel" value={formatRUsd(proof.latestLocalBalance)} />}
          {proof.diagnosticCheckedAt && <ProofRow label="Diagnostics checked" value={new Date(proof.diagnosticCheckedAt).toLocaleTimeString()} />}
          {proof.browserPeerCount !== undefined && <ProofRow label="Browser peer count" value={String(proof.browserPeerCount)} />}
          {proof.browserSeesOperatorPeer !== undefined && <ProofRow label="Browser sees operator" value={proof.browserSeesOperatorPeer ? 'Yes' : 'No'} />}
          {proof.browserTemporaryChannelState && <ProofRow label="Browser temp channel" value={proof.browserTemporaryChannelState} />}
          {proof.browserTemporaryChannelFailure && <ProofRow label="Browser channel failure" value={proof.browserTemporaryChannelFailure} />}
          {proof.operatorTemporaryChannelFailure && <ProofRow label="Operator channel failure" value={proof.operatorTemporaryChannelFailure} />}
          {proof.browserPendingChannelsSummary && <ProofRow label="Browser pending records" value={proof.browserPendingChannelsSummary} />}
          {proof.browserOperatorChannelsSummary && <ProofRow label="Browser operator channels" value={proof.browserOperatorChannelsSummary} />}
          {proof.operatorDiagnostics?.operatorSeesBrowserPeer !== undefined && <ProofRow label="Operator sees browser" value={proof.operatorDiagnostics.operatorSeesBrowserPeer ? 'Yes' : 'No'} />}
          {proof.operatorDiagnostics?.operatorPeerAddress && <ProofRow label="Operator peer address" value={Array.isArray(proof.operatorDiagnostics.operatorPeerAddress) ? proof.operatorDiagnostics.operatorPeerAddress.join(', ') : proof.operatorDiagnostics.operatorPeerAddress} />}
          {proof.operatorDiagnostics?.operatorSeesTemporaryChannel !== undefined && <ProofRow label="Operator sees temp channel" value={proof.operatorDiagnostics.operatorSeesTemporaryChannel ? 'Yes' : 'No'} />}
          {proof.operatorDiagnostics?.operatorChannelCountForBrowser !== undefined && <ProofRow label="Operator channel count" value={String(proof.operatorDiagnostics.operatorChannelCountForBrowser)} />}
          {proof.operatorDiagnostics?.operatorChannelsSummary?.length > 0 && (
            <ProofRow
              label="Operator channels"
              value={proof.operatorDiagnostics.operatorChannelsSummary.map((channel) => [
                shortId(channel.channelId || channel.temporaryChannelId || 'unknown', 8),
                channel.state || 'unknown',
                channel.flags || 'no flags',
                `local ${formatRUsd(channel.localBalance, true)}`,
                channel.channelOutpoint ? `outpoint ${shortId(channel.channelOutpoint, 8)}` : 'no outpoint',
              ].join(' / ')).join(' | ')}
            />
          )}
          {proof.operatorDiagnostics?.operatorPendingChannelsSummary?.length > 0 && (
            <ProofRow
              label="Operator pending records"
              value={proof.operatorDiagnostics.operatorPendingChannelsSummary.map((channel) => [
                shortId(channel.channelId || channel.temporaryChannelId || 'unknown', 8),
                channel.state || 'unknown',
                channel.flags || 'no flags',
                channel.failureDetail || 'no failure detail',
              ].join(' / ')).join(' | ')}
            />
          )}
          {proof.operatorDiagnostics?.operatorErrors?.length > 0 && <ProofRow label="Operator diagnostic errors" value={proof.operatorDiagnostics.operatorErrors.join(' | ')} />}
          {proof.diagnosticError && <ProofRow label="Browser diagnostic errors" value={proof.diagnosticError} />}
          {proof.clearedOperatorChannels?.cleared?.length > 0 && <ProofRow label="Cleared operator stale" value={proof.clearedOperatorChannels.cleared.join(', ')} />}
          {proof.clearedOperatorChannels?.errors?.length > 0 && <ProofRow label="Operator cleanup errors" value={proof.clearedOperatorChannels.errors.join(' | ')} />}
          {proof.clearedChannels?.length > 0 && <ProofRow label="Cleared stale channels" value={proof.clearedChannels.join(', ')} />}
          {proof.clearedManually && <ProofRow label="Cleared manually" value={proof.clearedManually} />}
          {proof.pendingChannels?.length > 0 && <ProofRow label="Pending channels" value={proof.pendingChannels.map((channel) => `${channel.channel_id}:${channelStateName(channel)}${channel.channel_outpoint ? ':funding-visible' : ''}`).join(', ')} />}
          {canClearTemporaryChannel && (
            <button type="button" className="secondaryBtn fullWidth" onClick={clearTemporaryChannel} disabled={loading}>
              Clear temporary channel
            </button>
          )}
        </ProofDrawer>
      )}
    </div>
  )
}

function ReceiveCard({ nodeInfo, onRefreshNetwork }) {
  const [amount, setAmount] = useState('1.00')
  const [description, setDescription] = useState('Dular payment request')
  const [invoice, setInvoice] = useState(null)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [bootstrap, setBootstrap] = useState(null)
  const needsOperatorRUsd = bootstrap?.nextAction === 'fund_operator_rusd'

  async function prepareReceivingRoute({ manageLoading = true } = {}) {
    if (!nodeInfo?.pubkey) return
    if (manageLoading) setLoading(true)
    setStatus(null)

    try {
      const fundingAmountBaseUnits = toBaseUnits(amount).toString()
      let result = await requestReceiveRoute(nodeInfo.pubkey, nodeInfo.addresses || [], { fundingAmountBaseUnits })
      setBootstrap(result)
      if (result.nextAction === 'fund_operator_rusd') {
        setStatus({
          type: 'warning',
          message: `Dular's testnet operator needs RUSD liquidity before it can prepare this receive route. Send at least ${formatRUsd(fundingAmountBaseUnits)} to the operator funding address shown below, then check the receive route again.`,
        })
        return
      }

      if (result.nextAction === 'accept_channel') {
        setStatus({ type: 'warning', message: 'Approving a secure receive route on this device...' })
        let accepted
        try {
          accepted = await acceptPendingChannel(result)
        } catch (error) {
          if (!isMissingTempChannelError(error)) throw error
          setStatus({ type: 'warning', message: 'Refreshing a stale receive route and trying again...' })
          result = await requestReceiveRoute(nodeInfo.pubkey, nodeInfo.addresses || [], { replacePending: true, fundingAmountBaseUnits })
          setBootstrap(result)
          accepted = await acceptPendingChannel(result)
        }
        if (!accepted.length) {
          throw new Error('No route reached this wallet yet. Keep this tab open, sync the wallet, then try again.')
        }
        setStatus({ type: 'warning', message: 'Receive route accepted. Waiting for it to become ready...' })
        await onRefreshNetwork({ silent: true })
        result = await retryReceiveRoute(nodeInfo.pubkey, nodeInfo.addresses || [], { fundingAmountBaseUnits })
        setBootstrap((current) => ({ ...(current || {}), ...result, acceptedChannels: accepted }))
        if (result.nextAction === 'fund_operator_rusd') {
          setStatus({
            type: 'warning',
            message: `Dular's testnet operator needs RUSD liquidity before it can finish this receive route. Send at least ${formatRUsd(fundingAmountBaseUnits)} to the operator funding address shown below, then check the receive route again.`,
          })
          return
        }
      }

      await onRefreshNetwork({ silent: true })
      setStatus({
        type: result.hopHints?.length ? 'success' : 'warning',
        message: result.hopHints?.length
          ? 'Ready to receive. Share this request with the sender.'
          : 'Request created, but the receive route is still becoming ready. Keep this wallet open and check the receive route again shortly.',
      })
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Could not prepare this payment request.' })
    } finally {
      if (manageLoading) setLoading(false)
    }
  }

  async function submit(event) {
    event.preventDefault()
    setLoading(true)
    setStatus(null)
    setInvoice(null)
    setBootstrap(null)

    try {
      const result = await browserCreateInvoice({
        amountHex: toBaseUnitsHex(amount),
        description,
      })
      setInvoice(result)
      setStatus({ type: 'warning', message: 'Payment request created. Preparing it so another Dular wallet can pay...' })
      await prepareReceivingRoute({ manageLoading: false })
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Could not create payment request.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <p className="muted receiveNote">
        Create a request and share it with the sender. Keep this wallet open until the payment completes.
      </p>
      <form onSubmit={submit}>
        <div className="formGroup">
          <label htmlFor="receive-amount">Amount to receive</label>
          <div className="amountField">
            <input id="receive-amount" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="1.00" required />
            <span>RUSD</span>
          </div>
        </div>
        <div className="formGroup">
          <label htmlFor="receive-note">Payment note</label>
          <input id="receive-note" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What is this payment for?" required />
        </div>
        <button type="submit" className="primaryBtn fullWidth" disabled={loading || !nodeInfo?.pubkey}>
          {loading ? 'Preparing payment request...' : 'Create payment request'}
        </button>
      </form>
      <Status state={status} />
      {invoice && (
        <div className="requestCard">
          <span className="requestLabel">Payment request</span>
          <code>{shortId(invoice.invoice_address, 18)}</code>
          <div className="buttonRow wrapButtons">
            <CopyButton value={invoice.invoice_address} label="Copy request" />
            <button type="button" className="secondaryBtn" onClick={() => prepareReceivingRoute()} disabled={loading}>
              {loading ? 'Checking route...' : 'Check receive route'}
            </button>
          </div>
          {needsOperatorRUsd && (
            <div className="routeHelpCard">
              <p className="eyebrow">Network action required</p>
              <h3>Add RUSD liquidity to the receive route</h3>
              <p>
                This beta route needs {formatRUsd(bootstrap.requiredOutboundLiquidity || '0')} of operator-side testnet RUSD liquidity.
                Send RUSD, not CKB, to the operator address, then check the receive route again.
              </p>
              <div className="buttonRow wrapButtons">
                <a className="secondaryBtn" href={RUSD_TESTNET_FAUCET_URL} target="_blank" rel="noreferrer">
                  Open RUSD faucet
                </a>
                <CopyButton value={bootstrap.operatorFundingAddress} label="Copy operator address" />
              </div>
            </div>
          )}
          {bootstrap && (
            <ProofDrawer summary="Receive proof">
              <ProofRow label="Invoice" value={invoice.invoice_address} />
              <ProofRow label="Payment hash" value={invoice.payment_hash} />
              {bootstrap.channelBootstrap?.temporary_channel_id && <ProofRow label="Bootstrap channel" value={bootstrap.channelBootstrap.temporary_channel_id} />}
              {bootstrap.readyChannel?.channel_id && <ProofRow label="Ready channel" value={bootstrap.readyChannel.channel_id} />}
              {bootstrap.hopHints?.length > 0 && <ProofRow label="Route hint" value={bootstrap.hopHints.map((hint) => `${hint.pubkey}:${hint.channel_outpoint}`).join(', ')} />}
              {bootstrap.acceptedChannels?.length > 0 && <ProofRow label="Accepted channels" value={bootstrap.acceptedChannels.map((channel) => channel.channelId).join(', ')} />}
              {bootstrap.pendingChannels?.length > 0 && <ProofRow label="Pending channels" value={bootstrap.pendingChannels.map((channel) => `${channel.channel_id}:${channelStateName(channel)}`).join(', ')} />}
              {bootstrap.abandonedPendingChannels?.length > 0 && <ProofRow label="Cleared stale channels" value={bootstrap.abandonedPendingChannels.join(', ')} />}
              {bootstrap.abandonPendingErrors?.length > 0 && <ProofRow label="Cleanup notes" value={bootstrap.abandonPendingErrors.join(' | ')} />}
              {bootstrap.outboundLiquidity && <ProofRow label="Operator outbound" value={formatRUsd(bootstrap.outboundLiquidity)} />}
              {bootstrap.requiredOutboundLiquidity && <ProofRow label="Required outbound" value={formatRUsd(bootstrap.requiredOutboundLiquidity)} />}
              {bootstrap.operatorOnChainRUsd !== undefined && bootstrap.operatorOnChainRUsd !== null && <ProofRow label="Operator on-chain RUSD" value={formatRUsd(bootstrap.operatorOnChainRUsd)} />}
              {bootstrap.operatorFundingAddress && <ProofRow label="Operator funding address" value={bootstrap.operatorFundingAddress} />}
              {bootstrap.connectError && <ProofRow label="Connect note" value={bootstrap.connectError} />}
            </ProofDrawer>
          )}
        </div>
      )}
    </>
  )
}

async function requestReceiveRoute(pubkey, addresses, options = {}) {
  return api('/fiber/browser/prepare-receive-route', {
    method: 'POST',
    body: JSON.stringify({ pubkey, addresses, ...options }),
  })
}

async function requestInvoiceRoute(invoice) {
  return api('/fiber/browser/invoice-route', {
    method: 'POST',
    body: JSON.stringify({ invoice }),
  })
}

async function requestPhoneRoute({ phone, amountBaseUnits, senderPubkey }) {
  return api('/fiber/browser/phone-route', {
    method: 'POST',
    body: JSON.stringify({ phone, amountBaseUnits, senderPubkey }),
  })
}

async function recordPhonePayment({ phone, amountBaseUnits, payment }) {
  return api('/payments/phone/record', {
    method: 'POST',
    body: JSON.stringify({
      phone,
      amountBaseUnits,
      paymentHash: payment.payment_hash,
      status: paymentStatusName(payment),
      feeBaseUnits: payment.fee || '0',
    }),
  })
}

async function requestBrowserDiagnostics(pubkey, temporaryChannelId = '') {
  return api('/fiber/browser/diagnostics', {
    method: 'POST',
    body: JSON.stringify({ pubkey, temporaryChannelId }),
  })
}

async function requestClearOperatorStale(pubkey) {
  return api('/fiber/browser/clear-operator-stale', {
    method: 'POST',
    body: JSON.stringify({ pubkey }),
  })
}

function summarizeChannels(channels = []) {
  if (!channels.length) return 'None'
  return channels.map((channel) => [
    shortId(channel.channel_id || 'unknown', 8),
    channelStateName(channel) || 'unknown',
    channel.state?.state_flags || channel.state_flags || 'no flags',
    `local ${formatRUsd(channelLocalBalanceBaseUnits(channel), true)}`,
    channel.channel_outpoint ? `outpoint ${shortId(channel.channel_outpoint, 8)}` : 'no outpoint',
  ].join(' / ')).join(' | ')
}

async function collectSelfChannelDiagnostics({ browserPubkey, operatorPubkey, temporaryChannelId, openedAt = 0 }) {
  const [browserPeers, browserChannels, browserPendingChannels, operatorDiagnostics] = await Promise.allSettled([
    browserListPeers(),
    browserListChannels(),
    browserListPendingChannels(),
    requestBrowserDiagnostics(browserPubkey, temporaryChannelId),
  ])

  const browserPeerList = browserPeers.status === 'fulfilled' ? browserPeers.value?.peers || [] : []
  const browserChannelList = browserChannels.status === 'fulfilled' ? browserChannels.value?.channels || [] : []
  const browserPendingChannelList = browserPendingChannels.status === 'fulfilled' ? browserPendingChannels.value?.channels || [] : []
  const normalizedOperator = normalizePubkey(operatorPubkey)
  const browserOperatorChannels = browserChannelList.filter((channel) => normalizePubkey(channel.pubkey) === normalizedOperator)
  const browserOpeningRecord = findChannelOpeningRecord(
    [...browserChannelList, ...browserPendingChannelList],
    { temporaryChannelId, peerPubkey: operatorPubkey, openedAt },
  )
  const operatorResult = operatorDiagnostics.status === 'fulfilled' ? operatorDiagnostics.value : null
  const operatorOpeningRecord = findChannelOpeningRecord(
    [
      ...(operatorResult?.operatorChannelsSummary || []),
      ...(operatorResult?.operatorPendingChannelsSummary || []),
    ],
    { temporaryChannelId, peerPubkey: browserPubkey, openedAt },
  )

  const diagnostics = {
    diagnosticCheckedAt: new Date().toISOString(),
    browserPeerCount: browserPeerList.length,
    browserSeesOperatorPeer: browserPeerList.some((peer) => normalizePubkey(peer.pubkey) === normalizedOperator),
    browserTemporaryChannelState: browserOpeningRecord ? `${channelStateName(browserOpeningRecord)} / ${browserOpeningRecord.state?.state_flags || browserOpeningRecord.state_flags || 'no flags'}` : 'Not visible in browser active or pending records',
    browserTemporaryChannelFailure: channelOpeningFailure(browserOpeningRecord),
    operatorTemporaryChannelFailure: channelOpeningFailure(operatorOpeningRecord),
    browserPendingChannelsSummary: summarizeChannels(browserPendingChannelList.filter((channel) => normalizePubkey(channel.pubkey) === normalizedOperator)),
    browserOperatorChannelsSummary: summarizeChannels(browserOperatorChannels),
    operatorDiagnostics: operatorResult,
    temporaryChannelMissing: Boolean(temporaryChannelId)
      && openedAt > 0
      && Date.now() - openedAt >= 20_000
      && !browserOpeningRecord
      && !operatorResult?.operatorSeesTemporaryChannel
      && !operatorOpeningRecord,
    diagnosticError: [
      browserPeers.status === 'rejected' ? `browser peers: ${browserPeers.reason?.message || browserPeers.reason}` : '',
      browserChannels.status === 'rejected' ? `browser channels: ${browserChannels.reason?.message || browserChannels.reason}` : '',
      browserPendingChannels.status === 'rejected' ? `browser pending channels: ${browserPendingChannels.reason?.message || browserPendingChannels.reason}` : '',
      operatorDiagnostics.status === 'rejected' ? `operator: ${operatorDiagnostics.reason?.message || operatorDiagnostics.reason}` : '',
    ].filter(Boolean).join(' | '),
  }
  console.info('Dular self-funded channel diagnostics', diagnostics)
  return diagnostics
}

async function retryReceiveRoute(pubkey, addresses, options = {}) {
  let result = null
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (attempt > 0) await wait(5000)
    result = await requestReceiveRoute(pubkey, addresses, options)
    if (result.readyChannel || result.hopHints?.length) return result
  }
  return result
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

async function clearStaleOperatorChannels(operatorPubkey) {
  const operator = normalizePubkey(operatorPubkey)
  const channels = await browserListChannels()
  const now = Date.now()
  const staleChannels = (channels.channels || []).filter((channel) => {
    if (normalizePubkey(channel.pubkey) !== operator) return false
    if (isReadyChannel(channel)) return false
    const createdAt = channelCreatedAtMs(channel)
    return createdAt === 0 || now - createdAt > 90_000
  })

  const cleared = []
  for (const channel of staleChannels) {
    try {
      await browserAbandonChannel(channel.channel_id)
      cleared.push(channel.channel_id)
    } catch {
      // Best-effort cleanup. Fiber may already have moved or removed the channel.
    }
  }
  return cleared
}

async function waitForSelfFundedChannel(browserPubkey, operatorPubkey, requiredBaseUnits, temporaryChannelId, openedAt, onUpdate) {
  let latestChannels = null
  let senderRoute = null
  let failure = ''

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (attempt > 0) await wait(5000)
    const [channelsResult, pendingResult, operatorResult] = await Promise.allSettled([
      browserListChannels(),
      browserListPendingChannels(),
      requestBrowserDiagnostics(browserPubkey, temporaryChannelId),
    ])
    if (channelsResult.status === 'rejected') throw channelsResult.reason
    latestChannels = channelsResult.value
    const pendingRecords = pendingResult.status === 'fulfilled' ? pendingResult.value?.channels || [] : []
    const openingRecord = findChannelOpeningRecord([
      ...(latestChannels.channels || []),
      ...pendingRecords,
    ], {
      temporaryChannelId,
      peerPubkey: operatorPubkey,
      openedAt,
    })
    const openingState = channelStateName(openingRecord)
    const openingFlags = openingRecord?.state?.state_flags || openingRecord?.state_flags || ''
    const operatorOpeningRecord = findChannelOpeningRecord(
      operatorResult.status === 'fulfilled' ? [
        ...(operatorResult.value?.operatorChannelsSummary || []),
        ...(operatorResult.value?.operatorPendingChannelsSummary || []),
      ] : [],
      { temporaryChannelId, peerPubkey: browserPubkey, openedAt },
    )
    senderRoute = findSenderRouteChannel(latestChannels, operatorPubkey, requiredBaseUnits)
    if (channelOpeningFailure(openingRecord) || channelOpeningFailure(operatorOpeningRecord)) {
      failure = channelOpeningFailure(openingRecord)
        || channelOpeningFailure(operatorOpeningRecord)
        || `${openingState || operatorOpeningRecord?.state || 'Closed'} ${openingFlags || operatorOpeningRecord?.flags || 'FUNDING_ABORTED'}`
      onUpdate?.({
        pendingChannels: [],
        browserTemporaryChannelFailure: failure,
        operatorTemporaryChannelFailure: channelOpeningFailure(operatorOpeningRecord),
        browserTemporaryChannelState: `${openingState || 'Closed'} / ${openingFlags || 'FUNDING_ABORTED'}`,
      })
      break
    }
    if (senderRoute.channel) break
    if (Date.now() - openedAt >= 20_000 && !openingRecord && !operatorOpeningRecord) {
      failure = 'Channel opening record disappeared before a funding transaction was created'
      onUpdate?.({
        pendingChannels: [],
        temporaryChannelMissing: true,
        browserTemporaryChannelFailure: failure,
      })
      break
    }
    const pendingChannels = pendingOperatorChannels(latestChannels, operatorPubkey)
    onUpdate?.({
      readyChannel: senderRoute.channel,
      latestLocalBalance: senderRoute.largestLocalBalance.toString(),
      pendingChannels,
      fundedPendingChannel: pendingChannels.find((channel) => channel.channel_outpoint) || null,
      senderRouteDiagnostics: describeSenderRouteChannels(latestChannels, operatorPubkey),
    })
  }

  return {
    latestChannels,
    channel: senderRoute?.channel || null,
    failure,
    diagnostics: describeSenderRouteChannels(latestChannels || { channels: [] }, operatorPubkey),
  }
}

function pendingOperatorChannels(channelsResult, operatorPubkey) {
  const operator = normalizePubkey(operatorPubkey)
  return (channelsResult?.channels || []).filter((channel) => (
    normalizePubkey(channel.pubkey) === operator && !isReadyChannel(channel)
  ))
}

async function acceptPendingChannel(seedResult) {
  const explicitIds = [
    seedResult?.channelBootstrap?.temporary_channel_id,
    seedResult?.pendingChannel?.channel_id,
    ...(seedResult?.pendingChannels || []).map((channel) => channel.channel_id),
  ].filter(Boolean)

  const uniqueExplicitIds = [...new Set(explicitIds)]
  const accepted = []
  for (const temporaryChannelId of uniqueExplicitIds) {
    try {
      await browserAcceptChannel({ temporaryChannelId, fundingAmountHex: '0x0' })
      accepted.push({ channelId: temporaryChannelId, source: 'backend' })
    } catch (error) {
      throw new Error(`${temporaryChannelId}: ${error.message || String(error)}`, { cause: error })
    }
  }

  if (accepted.length) return accepted

  const latest = await browserListChannels()
  const incoming = (latest.channels || []).filter((channel) => {
    const state = channelStateName(channel)
    return channel.is_acceptor !== false
      && state
      && state !== 'ChannelReady'
  })

  for (const channel of incoming) {
    try {
      await browserAcceptChannel({
        temporaryChannelId: channel.channel_id,
        fundingAmountHex: '0x0',
      })
      accepted.push({ channelId: channel.channel_id, state: channelStateName(channel), source: 'browser' })
    } catch (error) {
      accepted.push({ channelId: channel.channel_id, state: channelStateName(channel), source: 'browser', error: error.message || String(error) })
    }
  }

  const successful = accepted.filter((channel) => !channel.error)
  if (successful.length) return successful

  const errors = accepted.map((channel) => `${channel.channelId}: ${channel.error}`).join(' ')
  if (errors) throw new Error(`Could not accept pending channel. ${errors}`)
  return []
}

function channelLocalBalanceBaseUnits(channel) {
  return BigInt(channel?.local_balance || '0x0')
}

function isPublicChannel(channel) {
  return channel?.is_public === true || channel?.public === true
}

function normalizePubkey(value) {
  return String(value || '').trim().toLowerCase().replace(/^0x/, '')
}

function isCandidateSenderRouteChannel(channel) {
  return isReadyChannel(channel)
}

function findSenderRouteChannel(channels, operatorPubkey, requiredBaseUnits) {
  const operator = normalizePubkey(operatorPubkey)
  const readyOperatorChannels = (channels.channels || [])
    .filter(isCandidateSenderRouteChannel)
    .filter((channel) => normalizePubkey(channel.pubkey) === operator)
    .sort((a, b) => {
      const publicScore = Number(isPublicChannel(b)) - Number(isPublicChannel(a))
      if (publicScore !== 0) return publicScore
      const left = channelLocalBalanceBaseUnits(a)
      const right = channelLocalBalanceBaseUnits(b)
      if (left === right) return 0
      return left > right ? -1 : 1
    })

  return {
    channel: readyOperatorChannels.find((channel) => channelLocalBalanceBaseUnits(channel) >= requiredBaseUnits) || null,
    largestLocalBalance: readyOperatorChannels[0] ? channelLocalBalanceBaseUnits(readyOperatorChannels[0]) : 0n,
    channels: readyOperatorChannels,
  }
}

function describeSenderRouteChannels(channels, operatorPubkey) {
  const operator = normalizePubkey(operatorPubkey)
  const rows = (channels.channels || [])
    .filter((channel) => normalizePubkey(channel.pubkey) === operator)
    .map((channel) => [
      shortId(channel.channel_id || channel.channel_outpoint || 'unknown', 8),
      channelStateName(channel) || 'unknown',
      `local ${formatRUsd(channelLocalBalanceBaseUnits(channel), true)}`,
      isPublicChannel(channel) ? 'public' : 'public flag missing',
      `fee ${channel.tlc_fee_proportional_millionths || 'missing'}`,
    ].join(' / '))

  return rows.length ? rows.join(' | ') : 'No operator channels visible in this browser wallet.'
}

async function waitForSenderRouteChannel(operatorPubkey, requiredBaseUnits) {
  let latestChannels = null
  let senderRoute = null

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (attempt > 0) await wait(2000)
    latestChannels = await browserListChannels()
    senderRoute = findSenderRouteChannel(latestChannels, operatorPubkey, requiredBaseUnits)
    if (senderRoute.channel) break
  }

  return {
    latestChannels,
    senderRoute,
    diagnostics: describeSenderRouteChannels(latestChannels || { channels: [] }, operatorPubkey),
  }
}

async function waitForPaymentFinality(paymentHash, onUpdate) {
  let latest = null

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (attempt > 0) await wait(1000)
    latest = await browserGetPayment(paymentHash)
    onUpdate(latest)

    const status = paymentStatusName(latest)
    if (status === 'Success') return { final: true, payment: latest }
    if (isFailedPaymentStatus(status)) {
      throw new Error(latest.failed_error || `Fiber payment failed with status ${status}`)
    }
  }

  return { final: false, payment: latest }
}

function PayInvoiceCard({ onRefreshNetwork }) {
  const [invoice, setInvoice] = useState('')
  const [payment, setPayment] = useState(null)
  const [route, setRoute] = useState(null)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setLoading(true)
    setStatus(null)
    setPayment(null)
    setRoute(null)

    try {
      const latestChannels = await browserListChannels()
      const spendable = sumChannelBalance((latestChannels.channels || []).filter(isReadyChannel))
      if (spendable <= 0n) {
        throw new Error('No spendable RUSD is ready yet. Fund from faucets, activate RUSD, keep the wallet open, then try sending again.')
      }
      const routeResult = await requestInvoiceRoute(invoice)
      setRoute(routeResult)
      if (!routeResult.routeReady) {
        throw new Error(routeResult.reason || 'Receiver route is not ready. Ask the receiver to keep their wallet open and prepare a receiving route.')
      }
      const requiredOutbound = BigInt(routeResult.senderRequiredOutboundBaseUnits || routeResult.amountBaseUnits || '0')
      const { senderRoute, diagnostics } = await waitForSenderRouteChannel(routeResult.operatorPubkey, requiredOutbound)
      if (!senderRoute.channel) {
        setRoute((current) => ({
          ...(current || routeResult),
          senderRouteDiagnostics: diagnostics,
        }))
        throw new Error(
          `Not enough ready RUSD to send this payment. Needed ${formatRUsd(requiredOutbound)}, available route balance is ${formatRUsd(senderRoute.largestLocalBalance)}. Fund from faucets, activate RUSD, wait for sync, then retry.`,
        )
      }

      setRoute((current) => ({
        ...(current || routeResult),
        senderRouteChannel: senderRoute.channel,
        senderRouteDiagnostics: diagnostics,
      }))

      const result = await browserSendPayment(invoice, { hopHints: routeResult.hopHints || [] })
      setPayment(result)
      if (!result.payment_hash) {
        setStatus({ type: 'warning', message: `Payment submitted, but Fiber returned no payment hash. Status: ${paymentStatusName(result)}.` })
        return
      }

      setStatus({ type: 'warning', message: 'Payment submitted from your wallet. Waiting for Fiber confirmation...' })
      const finalResult = await waitForPaymentFinality(result.payment_hash, setPayment)
      const finalStatus = paymentStatusName(finalResult.payment)
      setStatus({
        type: finalResult.final ? 'success' : 'warning',
        message: finalResult.final
          ? 'Payment completed on Fiber.'
          : `Payment is still ${finalStatus}. Keep both wallets open and refresh payment shortly.`,
      })
      await onRefreshNetwork?.({ silent: true })
    } catch (error) {
      setStatus({ type: 'error', message: errorMessage(error, 'Could not send payment.') })
    } finally {
      setLoading(false)
    }
  }

  async function refreshPayment() {
    if (!payment?.payment_hash) return
    setLoading(true)
    try {
      const latest = await browserGetPayment(payment.payment_hash)
      setPayment(latest)
      const status = paymentStatusName(latest)
      setStatus({
        type: status === 'Success' ? 'success' : isFailedPaymentStatus(status) ? 'error' : 'warning',
        message: status === 'Success'
          ? 'Payment completed on Fiber.'
          : `Payment status refreshed: ${status}.`,
      })
      if (status === 'Success') await onRefreshNetwork?.({ silent: true })
    } catch (error) {
      setStatus({ type: 'error', message: errorMessage(error, 'Could not refresh payment.') })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <form onSubmit={submit}>
        <p className="muted receiveNote">
          Paste the receiver's payment request. Dular will check the route and send from your spendable balance.
        </p>
        <div className="formGroup">
          <label htmlFor="send-request">Payment request</label>
          <textarea
            id="send-request"
            className="textAreaField"
            value={invoice}
            onChange={(event) => setInvoice(event.target.value)}
            placeholder="Paste the request from the receiver"
            required
          />
        </div>
        <div className="buttonRow wrapButtons">
          <button type="submit" className="primaryBtn fullWidth" disabled={loading}>
            {loading ? 'Sending RUSD...' : 'Review and send RUSD'}<SendHorizontal size={18} />
          </button>
        </div>
      </form>
      <Status state={status} />
      {route && (
        <ProofDrawer summary="Send route proof">
          <ProofRow label="Operator route" value={route.operatorPubkey || 'Unknown'} />
          <ProofRow label="Invoice payee" value={route.payeePubkey || 'Unknown'} />
          <ProofRow label="Hop hints allowed" value={route.supportsHopHints ? 'Yes' : 'No'} />
          <ProofRow label="Receiver connected" value={route.connected ? 'Yes' : 'No'} />
          <ProofRow label="Route ready" value={route.routeReady ? 'Yes' : 'No'} />
          {route.amountBaseUnits && <ProofRow label="Invoice amount" value={formatRUsd(route.amountBaseUnits)} />}
          {route.senderRequiredOutboundBaseUnits && <ProofRow label="Sender required" value={formatRUsd(route.senderRequiredOutboundBaseUnits)} />}
          {route.estimatedFinalHopFeeBaseUnits && <ProofRow label="Route fee" value={formatRUsd(route.estimatedFinalHopFeeBaseUnits)} />}
          {route.outboundLiquidity && <ProofRow label="Receiver inbound route" value={formatRUsd(route.outboundLiquidity)} />}
          {route.senderRouteChannel?.channel_outpoint && <ProofRow label="Sender route channel" value={route.senderRouteChannel.channel_outpoint} />}
          {route.senderRouteChannel && <ProofRow label="Sender route public" value={isPublicChannel(route.senderRouteChannel) ? 'Yes' : 'No'} />}
          {route.senderRouteChannel && <ProofRow label="Sender route fee rate" value={route.senderRouteChannel.tlc_fee_proportional_millionths || 'Unknown'} />}
          {route.senderRouteDiagnostics && <ProofRow label="Sender channels" value={route.senderRouteDiagnostics} />}
          {route.routeChannel && <ProofRow label="Receiver route public" value={isPublicChannel(route.routeChannel) ? 'Yes' : 'No'} />}
          {route.routeChannel && <ProofRow label="Receiver route fee rate" value={route.routeChannel.tlc_fee_proportional_millionths || 'Unknown'} />}
          {route.routeReady && route.hopHints?.length > 0 && <ProofRow label="Private route hint" value={route.hopHints.map((hint) => `${hint.pubkey}:${hint.channel_outpoint}`).join(', ')} />}
          {route.reason && <ProofRow label="Route note" value={route.reason} />}
        </ProofDrawer>
      )}
      {payment && (
        <div className="paymentResultCard">
          <div>
            <span>Payment status</span>
            <strong>{paymentStatusName(payment)}</strong>
            <p>{payment.payment_hash ? shortId(payment.payment_hash, 14) : 'Waiting for payment hash'}</p>
          </div>
          <div className="buttonRow wrapButtons">
            <button type="button" className="secondaryBtn iconTextBtn" onClick={refreshPayment} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} /> Check payment</button>
            {payment.payment_hash && <CopyButton value={payment.payment_hash} label="Copy hash" />}
          </div>
          <ProofDrawer summary="Payment proof">
            <ProofRow label="Payment hash" value={payment.payment_hash || 'Pending'} />
            <ProofRow label="Status" value={paymentStatusName(payment)} />
            {payment.fee && <ProofRow label="Fee" value={payment.fee} />}
            {payment.failed_error && <ProofRow label="Failure" value={payment.failed_error} />}
          </ProofDrawer>
        </div>
      )}
    </>
  )
}

function PhonePaymentCard({ nodeInfo, onRefreshNetwork }) {
  const [phone, setPhone] = useState('')
  const [amount, setAmount] = useState('')
  const [route, setRoute] = useState(null)
  const [payment, setPayment] = useState(null)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)

  function updatePhone(value) {
    setPhone(value)
    setRoute(null)
    setPayment(null)
    setStatus(null)
  }

  function updateAmount(value) {
    setAmount(value)
    setRoute(null)
    setPayment(null)
    setStatus(null)
  }

  async function resolveRecipient(event) {
    event.preventDefault()
    setLoading(true)
    setStatus(null)
    setPayment(null)
    setRoute(null)

    try {
      if (!nodeInfo?.pubkey) throw new Error('The browser wallet is still starting')
      const amountBaseUnits = toBaseUnits(amount)
      if (amountBaseUnits <= 0n) throw new Error('Enter an RUSD amount greater than zero')

      const latestChannels = await browserListChannels()
      const spendable = sumChannelBalance((latestChannels.channels || []).filter(isReadyChannel))
      if (spendable < amountBaseUnits) {
        throw new Error(`Not enough spendable RUSD. Available: ${formatRUsd(spendable)}.`)
      }

      const resolved = await requestPhoneRoute({
        phone,
        amountBaseUnits: amountBaseUnits.toString(),
        senderPubkey: nodeInfo.pubkey,
      })
      if (!resolved.routeReady) {
        setRoute(resolved)
        throw new Error(resolved.reason || 'The recipient has no usable Fiber route right now')
      }

      const requiredOutbound = BigInt(resolved.senderRequiredOutboundBaseUnits || resolved.amountBaseUnits)
      const { senderRoute, diagnostics } = await waitForSenderRouteChannel(resolved.operatorPubkey, requiredOutbound)
      const nextRoute = {
        ...resolved,
        senderRouteChannel: senderRoute.channel,
        senderRouteDiagnostics: diagnostics,
      }
      setRoute(nextRoute)
      if (!senderRoute.channel) {
        throw new Error(
          `Not enough ready RUSD to send this payment. Needed ${formatRUsd(requiredOutbound)}, available route balance is ${formatRUsd(senderRoute.largestLocalBalance)}.`,
        )
      }
      setStatus({ type: 'success', message: 'Registered recipient and Fiber route verified. Review the payment before sending.' })
    } catch (error) {
      setStatus({ type: 'error', message: errorMessage(error, 'Could not resolve this Dular number.') })
    } finally {
      setLoading(false)
    }
  }

  async function sendPayment() {
    if (!route?.routeReady || !route.recipient?.fiberPubkey) return
    setLoading(true)
    setStatus({ type: 'warning', message: 'Running a final Fiber route check...' })

    try {
      const amountBaseUnits = BigInt(route.amountBaseUnits)
      const keysend = {
        targetPubkey: route.recipient.fiberPubkey,
        amountHex: baseUnitsHex(amountBaseUnits),
        hopHints: route.hopHints || [],
      }
      await browserSendKeysend({ ...keysend, dryRun: true })
      setStatus({ type: 'warning', message: 'Route verified. Sending RUSD over Fiber...' })
      const submitted = await browserSendKeysend(keysend)
      setPayment(submitted)
      if (!submitted.payment_hash) {
        setStatus({ type: 'warning', message: `Payment submitted, but Fiber returned no payment hash. Status: ${paymentStatusName(submitted)}.` })
        return
      }

      setStatus({ type: 'warning', message: 'Payment submitted. Waiting for Fiber confirmation...' })
      const finalResult = await waitForPaymentFinality(submitted.payment_hash, setPayment)
      if (!finalResult.final) {
        setStatus({ type: 'warning', message: `Payment is still ${paymentStatusName(finalResult.payment)}. Keep both wallets open.` })
        return
      }

      let receiptRecorded = true
      try {
        await recordPhonePayment({
          phone: route.recipient.phone,
          amountBaseUnits: route.amountBaseUnits,
          payment: finalResult.payment,
        })
      } catch {
        receiptRecorded = false
      }
      setStatus({
        type: receiptRecorded ? 'success' : 'warning',
        message: receiptRecorded
          ? `Payment completed to ${route.recipient.phone}.`
          : `Payment completed to ${route.recipient.phone}, but the Dular receipt will need to be retried.`,
      })
      await onRefreshNetwork?.({ silent: true })
    } catch (error) {
      setStatus({ type: 'error', message: errorMessage(error, 'Could not send this phone payment.') })
    } finally {
      setLoading(false)
    }
  }

  async function refreshPayment() {
    if (!payment?.payment_hash) return
    setLoading(true)
    try {
      const latest = await browserGetPayment(payment.payment_hash)
      setPayment(latest)
      const latestStatus = paymentStatusName(latest)
      if (latestStatus === 'Success') {
        await recordPhonePayment({
          phone: route.recipient.phone,
          amountBaseUnits: route.amountBaseUnits,
          payment: latest,
        })
        await onRefreshNetwork?.({ silent: true })
      }
      setStatus({
        type: latestStatus === 'Success' ? 'success' : isFailedPaymentStatus(latestStatus) ? 'error' : 'warning',
        message: latestStatus === 'Success'
          ? `Payment completed to ${route.recipient.phone}.`
          : `Payment status refreshed: ${latestStatus}.`,
      })
    } catch (error) {
      setStatus({ type: 'error', message: errorMessage(error, 'Could not refresh this phone payment.') })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <form onSubmit={resolveRecipient}>
        <p className="muted receiveNote">The recipient must be registered, online, and have enough Fiber receive capacity.</p>
        <div className="formGroup">
          <label htmlFor="fiber-phone-recipient">Dular phone number</label>
          <input id="fiber-phone-recipient" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => updatePhone(event.target.value)} placeholder="0712 345 678" required />
        </div>
        <div className="formGroup">
          <label htmlFor="fiber-phone-amount">Amount to send</label>
          <div className="amountField">
            <input id="fiber-phone-amount" value={amount} onChange={(event) => updateAmount(event.target.value)} inputMode="decimal" placeholder="1.00" required />
            <span>RUSD</span>
          </div>
        </div>
        <button type="submit" className="primaryBtn fullWidth" disabled={loading}>
          {loading && !route ? 'Checking recipient...' : 'Check recipient'}<Smartphone size={18} />
        </button>
      </form>
      <Status state={status} />
      {route && (
        <ProofDrawer summary="Phone route proof">
          <ProofRow label="Recipient phone" value={route.recipient?.phone || phone} />
          <ProofRow label="Fiber identity" value={route.recipient?.fiberPubkey || 'Unavailable'} />
          <ProofRow label="Recipient online" value={route.connected ? 'Yes' : 'No'} />
          <ProofRow label="Route ready" value={route.routeReady ? 'Yes' : 'No'} />
          <ProofRow label="Amount" value={formatRUsd(route.amountBaseUnits || '0')} />
          <ProofRow label="Inbound liquidity" value={formatRUsd(route.outboundLiquidity || '0')} />
          {route.routeChannel?.channel_outpoint && <ProofRow label="Recipient route" value={route.routeChannel.channel_outpoint} />}
          {route.senderRouteChannel?.channel_outpoint && <ProofRow label="Sender route" value={route.senderRouteChannel.channel_outpoint} />}
          {route.reason && <ProofRow label="Route note" value={route.reason} />}
        </ProofDrawer>
      )}
      {route?.routeReady && route.senderRouteChannel && !payment && (
        <div className="phonePaymentConfirm">
          <div>
            <span>Ready to send</span>
            <strong>{formatRUsd(route.amountBaseUnits)} to {route.recipient.phone}</strong>
          </div>
          <button type="button" className="primaryBtn" onClick={sendPayment} disabled={loading}>
            {loading ? 'Sending...' : 'Send now'}<SendHorizontal size={18} />
          </button>
        </div>
      )}
      {payment && (
        <div className="paymentResultCard">
          <div>
            <span>Payment status</span>
            <strong>{paymentStatusName(payment)}</strong>
            <p>{payment.payment_hash ? shortId(payment.payment_hash, 14) : 'Waiting for payment hash'}</p>
          </div>
          <div className="buttonRow wrapButtons">
            <button type="button" className="secondaryBtn iconTextBtn" onClick={refreshPayment} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} /> Check payment</button>
            {payment.payment_hash && <CopyButton value={payment.payment_hash} label="Copy hash" />}
          </div>
          <ProofDrawer summary="Phone payment proof">
            <ProofRow label="Recipient" value={route.recipient.phone} />
            <ProofRow label="Fiber identity" value={route.recipient.fiberPubkey} />
            <ProofRow label="Payment hash" value={payment.payment_hash || 'Pending'} />
            <ProofRow label="Status" value={paymentStatusName(payment)} />
            {payment.fee && <ProofRow label="Fee" value={payment.fee} />}
            {payment.failed_error && <ProofRow label="Failure" value={payment.failed_error} />}
          </ProofDrawer>
        </div>
      )}
    </>
  )
}

function SendCard({ nodeInfo, onRefreshNetwork }) {
  const [mode, setMode] = useState('phone')

  return (
    <>
      <div className="rampSegmented sendSegmented" role="group" aria-label="RUSD payment method">
        <button type="button" className={mode === 'phone' ? 'active' : ''} aria-pressed={mode === 'phone'} onClick={() => setMode('phone')}>
          <Smartphone size={16} /> Phone
        </button>
        <button type="button" className={mode === 'invoice' ? 'active' : ''} aria-pressed={mode === 'invoice'} onClick={() => setMode('invoice')}>
          <SendHorizontal size={16} /> Payment request
        </button>
      </div>
      <div className="sendModeBody">
        {mode === 'phone'
          ? <PhonePaymentCard nodeInfo={nodeInfo} onRefreshNetwork={onRefreshNetwork} />
          : <PayInvoiceCard onRefreshNetwork={onRefreshNetwork} />}
      </div>
    </>
  )
}

function ProofRow({ label, value }) {
  return (
    <div className="proofRow">
      <span>{label}</span>
      <code>{value}</code>
    </div>
  )
}

export default function SelfCustodyApp() {
  const [user, setUser] = useState(null)
  const [booting, setBooting] = useState(true)
  const [walletRecord, setWalletRecord] = useState(null)
  const [walletStatus, setWalletStatus] = useState('idle')
  const [setupStatus, setSetupStatus] = useState(null)
  const [nodeInfo, setNodeInfo] = useState(null)
  const [operatorInfo, setOperatorInfo] = useState(null)
  const [peers, setPeers] = useState({ peers: [] })
  const [channels, setChannels] = useState({ channels: [] })
  const [funding, setFunding] = useState(null)
  const [networkStatus, setNetworkStatus] = useState(null)
  const [refreshingNetwork, setRefreshingNetwork] = useState(false)
  const [lastNetworkRefreshAt, setLastNetworkRefreshAt] = useState('')
  const runtimeRef = useRef(null)
  const userId = user?.id

  const refreshNetwork = useCallback(async ({ silent = false } = {}) => {
    setRefreshingNetwork(true)
    if (!silent) {
      setNetworkStatus({ type: 'warning', message: 'Refreshing wallet network state...' })
    }

    const [infoResult, peersResult, channelsResult, operatorResult] = await Promise.allSettled([
      browserNodeInfo(),
      browserListPeers(),
      browserListChannels(),
      api('/fiber/operator'),
    ])

    if (infoResult.status !== 'fulfilled') {
      const message = infoResult.reason?.message || 'Browser Fiber node is not responding yet.'
      setNetworkStatus({ type: 'error', message })
      setRefreshingNetwork(false)
      throw new Error(message)
    }

    const nextInfo = infoResult.value
    setNodeInfo(nextInfo)

    const partialErrors = []
    let nextPeers = peersResult.status === 'fulfilled' ? peersResult.value : { peers: [] }
    if (peersResult.status === 'fulfilled') {
      setPeers(nextPeers)
    } else {
      partialErrors.push(peersResult.reason?.message || 'Could not refresh peers.')
    }

    if (channelsResult.status === 'fulfilled') {
      setChannels(channelsResult.value)
    } else {
      partialErrors.push(channelsResult.reason?.message || 'Could not refresh channels.')
    }

    if (operatorResult.status === 'fulfilled') {
      setOperatorInfo(operatorResult.value)
      const operator = operatorResult.value
      const operatorPubkey = String(operator.operator?.pubkey || '').toLowerCase()
      const operatorConnected = (nextPeers.peers || []).some(
        (peer) => String(peer.pubkey || '').toLowerCase() === operatorPubkey,
      )
      if (operatorPubkey && operator.wsAddress && !operatorConnected) {
        try {
          const addrType = operator.addrType || (operator.wsAddress.includes('/wss') ? 'wss' : 'ws')
          await browserConnectPeer({ address: operator.wsAddress, pubkey: operatorPubkey, addrType })
          nextPeers = await browserListPeers()
          setPeers(nextPeers)
        } catch (error) {
          partialErrors.push(`Could not reconnect to the Dular operator: ${error.message || 'request failed'}`)
        }
      }
      try {
        const diagnostics = await api('/fiber/browser/diagnostics', {
          method: 'POST',
          body: JSON.stringify({}),
        })
        if (!diagnostics.operatorSeesBrowserPeer) {
          partialErrors.push('The Dular operator does not see this wallet online yet. Keep this tab open and refresh again.')
        }
      } catch (error) {
        partialErrors.push(error.message || 'Could not verify the operator peer connection.')
      }
    } else {
      partialErrors.push(operatorResult.reason?.message || 'Could not refresh operator capacity.')
    }

    const lockArg = getFundingLockArg(nextInfo)
    if (lockArg) {
      try {
        const nextFunding = await api('/fiber/browser/address', {
          method: 'POST',
          body: JSON.stringify({ lockArg }),
        })
        setFunding((current) => ({ ...(current || {}), ...nextFunding }))
      } catch (error) {
        partialErrors.push(error.message || 'Could not refresh wallet CKB capacity.')
      }
    } else {
      partialErrors.push('Wallet funding lock was not available yet.')
    }

    const checkedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setLastNetworkRefreshAt(checkedAt)
    if (!silent || partialErrors.length) {
      setNetworkStatus(
        partialErrors.length
          ? { type: 'warning', message: `Network refreshed with warnings: ${partialErrors.join(' ')}` }
          : { type: 'success', message: 'Network state refreshed.' },
      )
    }
    setRefreshingNetwork(false)
    return nextInfo
  }, [])

  const registerDevice = useCallback(async (pubkey, fundingLockArg, proofInvoice, ckbProof) => {
    const result = await api('/fiber/register-device', {
      method: 'POST',
      body: JSON.stringify({ fiberPubkey: pubkey, fundingLockArg, proofInvoice, ...ckbProof }),
    })
    setUser(result.user)
    return result.user
  }, [])

  const startWalletNode = useCallback(async (phone, unlockedWallet) => {
    setWalletStatus('starting')
    const runtime = await startBrowserFiber({
      fiberSecretKey: unlockedWallet.fiberSecretKey,
      ckbSecretKey: unlockedWallet.ckbSecretKey,
      databasePrefix: `/dular-self-custody/${phone}`,
    })
    runtimeRef.current = runtime
    const info = await browserNodeInfo()
    const startupWarnings = []
    const fundingLockArg = getFundingLockArg(info)

    const registrationProof = await browserCreateInvoice({
      amountHex: '0x1',
      description: `Dular wallet registration ${userId} ${fundingLockArg}`,
    })
    const ckbProof = createCkbRegistrationProof({
      userId,
      fiberPubkey: info.pubkey,
      fundingLockArg,
      secretKey: unlockedWallet.ckbSecretKey,
    })
    await registerDevice(info.pubkey, fundingLockArg, registrationProof.invoice_address, ckbProof)

    try {
      const operator = await api('/fiber/operator')
      setOperatorInfo(operator)
      const addrType = operator.addrType || (operator.wsAddress?.includes('/wss') ? 'wss' : 'ws')
      await browserConnectPeer({ address: operator.wsAddress, pubkey: operator.operator?.pubkey, addrType })
    } catch (error) {
      startupWarnings.push(`Dular operator is not reachable: ${error.message || 'request failed'}`)
    }

    try {
      await refreshNetwork({ silent: true })
    } catch (error) {
      startupWarnings.push(`Could not refresh wallet network state: ${error.message || 'request failed'}`)
    }

    if (startupWarnings.length) {
      setNetworkStatus({
        type: 'warning',
        message: `Wallet opened with limited network access. ${startupWarnings.join(' ')}`,
      })
    }
    setWalletStatus('ready')
    return { info, startupWarnings }
  }, [refreshNetwork, registerDevice, userId])

  async function createWallet(pin, confirmPin) {
    if (user.walletBound) {
      setSetupStatus({ type: 'error', message: 'This account is already linked to a different device wallet.' })
      return
    }
    if (pin.length < 4) {
      setSetupStatus({ type: 'error', message: 'Use a PIN with at least 4 digits.' })
      return
    }
    if (pin !== confirmPin) {
      setSetupStatus({ type: 'error', message: 'PIN confirmation does not match.' })
      return
    }

    setSetupStatus(null)
    setWalletStatus('creating')
    try {
      const nextRecord = await createWalletRecord(user.phone, pin)
      setWalletRecord(nextRecord)
      const unlocked = await unlockWalletRecord(nextRecord, pin)
      const startup = await startWalletNode(user.phone, unlocked)
      setSetupStatus({
        type: startup.startupWarnings.length ? 'warning' : 'success',
        message: startup.startupWarnings.length
          ? 'Wallet created. Some network services are not reachable yet, so payments may be limited until the operator is online.'
          : 'Device wallet created and synced.',
      })
    } catch (error) {
      await stopBrowserFiber().catch(() => {})
      runtimeRef.current = null
      setSetupStatus({ type: 'error', message: error.message || 'Could not create wallet.' })
      setWalletStatus('idle')
    }
  }

  async function unlockWallet(pin) {
    setSetupStatus(null)
    setWalletStatus('unlocking')
    let unlocked
    try {
      unlocked = await unlockWalletRecord(walletRecord, pin)
    } catch {
      setSetupStatus({ type: 'error', message: 'Could not unlock this wallet. Check the PIN and try again.' })
      setWalletStatus('idle')
      return
    }

    try {
      const startup = await startWalletNode(user.phone, unlocked)
      setSetupStatus({
        type: startup.startupWarnings.length ? 'warning' : 'success',
        message: startup.startupWarnings.length
          ? 'PIN accepted. Wallet opened with limited network access, so payments may be limited until the operator is online.'
          : 'Device wallet unlocked.',
      })
    } catch (error) {
      await stopBrowserFiber().catch(() => {})
      runtimeRef.current = null
      setSetupStatus({
        type: 'error',
        message: `PIN accepted, but the browser Fiber wallet could not start: ${error.message || 'startup failed'}`,
      })
      setWalletStatus('idle')
    }
  }

  async function signOut() {
    await stopBrowserFiber()
    runtimeRef.current = null
    clearAuthToken()
    setNodeInfo(null)
    setOperatorInfo(null)
    setPeers({ peers: [] })
    setChannels({ channels: [] })
    setFunding(null)
    setNetworkStatus(null)
    setLastNetworkRefreshAt('')
    setWalletStatus('idle')
    setWalletRecord(null)
    setSetupStatus(null)
    setUser(null)
  }

  async function handleAuth(nextUser) {
    const existingRecord = await loadWalletRecord(nextUser.phone)
    setWalletRecord(existingRecord || null)
    setSetupStatus(null)
    setWalletStatus(existingRecord ? 'locked' : 'idle')
    setUser(nextUser)
  }

  async function lockWallet() {
    await stopBrowserFiber()
    runtimeRef.current = null
    setNodeInfo(null)
    setOperatorInfo(null)
    setPeers({ peers: [] })
    setChannels({ channels: [] })
    setFunding(null)
    setNetworkStatus(null)
    setLastNetworkRefreshAt('')
    setWalletStatus('locked')
  }

  useEffect(() => {
    let active = true
    async function boot() {
      if (!getAuthToken()) {
        setBooting(false)
        return
      }

      try {
        const result = await api('/me')
        const existingRecord = await loadWalletRecord(result.user.phone)
        if (!active) return
        setUser(result.user)
        setWalletRecord(existingRecord || null)
      } catch {
        clearAuthToken()
      } finally {
        if (active) setBooting(false)
      }
    }

    boot()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => () => {
    stopBrowserFiber().catch(() => {})
  }, [])

  useEffect(() => {
    if (walletStatus !== 'ready') return undefined

    const timer = setInterval(() => {
      refreshNetwork({ silent: true }).catch(() => {})
    }, 10000)

    return () => clearInterval(timer)
  }, [refreshNetwork, walletStatus])

  if (booting) {
    return (
      <div className="bootScreen">
        <BrandMark />
        <p>Loading your device wallet...</p>
      </div>
    )
  }

  if (!user) {
    return <AuthGate onAuth={handleAuth} />
  }

  if (!canUseBrowserFiber()) {
    return (
      <main className="authShell">
        <WalletHero />
        <section className="authPanel">
          <h2>This browser cannot open the wallet</h2>
          <p className="muted">
            Open Dular over a secure HTTPS connection in a supported browser, then try again.
          </p>
          <div className="buttonRow wrapButtons">
            <button type="button" className="secondaryBtn" onClick={signOut}>Sign out</button>
          </div>
        </section>
      </main>
    )
  }

  if (walletStatus !== 'ready') {
    return (
      <main className="authShell">
        <WalletHero />
        <section className="authPanel">
          <SetupCard
            phone={user.phone}
            hasExistingWallet={Boolean(walletRecord)}
            walletBound={Boolean(user.walletBound)}
            onCreate={createWallet}
            onUnlock={unlockWallet}
            loading={['creating', 'unlocking', 'starting'].includes(walletStatus)}
            status={setupStatus}
          />
          <div className="buttonRow wrapButtons">
            <button type="button" className="secondaryBtn" onClick={signOut}>Sign out</button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <SelfCustodyDashboard
      user={user}
      nodeInfo={nodeInfo}
      peers={peers}
      channels={channels}
      funding={funding}
      walletStatus={walletStatus}
      networkStatus={networkStatus}
      refreshingNetwork={refreshingNetwork}
      lastNetworkRefreshAt={lastNetworkRefreshAt}
      onLock={lockWallet}
      onSignOut={signOut}
      onRefreshNetwork={refreshNetwork}
      operatorInfo={operatorInfo}
    />
  )
}
