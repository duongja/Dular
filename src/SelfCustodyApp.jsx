import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowDownLeft,
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
  browserListPeers,
  browserNodeInfo,
  browserOpenRUsdChannel,
  browserSendPayment,
  canUseBrowserFiber,
  startBrowserFiber,
  stopBrowserFiber,
  browserUpdateChannel,
} from './lib/fiberBrowserNode.js'
import {
  createWalletRecord,
  deleteWalletRecord,
  loadWalletRecord,
  unlockWalletRecord,
} from './lib/browserWalletStore.js'
import BrandMark from './BrandMark.jsx'
import heroArt from './assets/hero.png'
import './App.css'

const RUSD_BASE = 100000000n
const MIN_OPERATOR_CHANNEL_CAPACITY = 200n * 100000000n
const CKB_TESTNET_FAUCET_URL = 'https://faucet.nervos.org/'
const RUSD_TESTNET_FAUCET_URL = 'https://testnet0815.stablepp.xyz/stablecoin'
const SELF_CUSTODY_NAV_ITEMS = [
  { id: 'home', label: 'Dashboard', Icon: Home },
  { id: 'fund', label: 'Fund', Icon: Landmark },
  { id: 'receive', label: 'Receive', Icon: ArrowDownLeft },
  { id: 'send', label: 'Send', Icon: ArrowUpRight },
  { id: 'wallet', label: 'Wallet', Icon: WalletCards },
]

function token() {
  return localStorage.getItem('dular_token') || ''
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
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

function operatorRUsdAutoAcceptBaseUnits(operatorInfo) {
  const rusdInfo = (operatorInfo?.operator?.udt_cfg_infos || []).find((asset) => asset.name === 'RUSD')
  const raw = rusdInfo?.auto_accept_amount
  if (!raw) return 0n
  return BigInt(String(raw))
}

function sumChannelBalance(channels = []) {
  return channels.reduce((total, channel) => total + BigInt(channel.local_balance || '0x0'), 0n)
}

function channelStateName(channel) {
  return channel?.state?.state_name || channel?.state_name || ''
}

function isReadyChannel(channel) {
  return channelStateName(channel) === 'ChannelReady'
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
      localStorage.setItem('dular_token', result.token)
      onAuth(result.user)
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

function SetupCard({ phone, onCreate, onUnlock, hasExistingWallet, loading, status }) {
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
        <h1>{hasExistingWallet ? 'Unlock this wallet' : 'Create a device wallet'}</h1>
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
                <button type="button" className="secondaryBtn fullWidth" onClick={() => openTab('fund')}>
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

        <section className="walletPanel" role="tabpanel" aria-label="Fund wallet" hidden={tab !== 'fund'}>
          <div className="screenStack">
            <section className="flowHero">
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
              <h1>Pay a request</h1>
              <p>Paste a payment request and send from your spendable RUSD balance.</p>
            </section>
            <section className="contentCard mobileActionCard">
              <PayInvoiceCard onRefreshNetwork={onRefreshNetwork} />
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
      setProof((current) => ({ ...(current || {}), opened, clearedChannels, clearedOperatorChannels }))
      const initialDiagnostics = await collectSelfChannelDiagnostics({
        browserPubkey: nodeInfo.pubkey,
        operatorPubkey,
        temporaryChannelId: opened.temporary_channel_id,
      })
      setProof((current) => ({ ...(current || {}), ...initialDiagnostics }))

      setStatus({ type: 'warning', message: 'Channel funding started. Keep this tab open while CKB confirms the channel.' })
      const ready = await waitForSelfFundedChannel(operatorPubkey, fundingAmountBaseUnits, (snapshot) => {
        setProof((current) => ({ ...(current || {}), ...snapshot }))
      })
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
      <Status state={status} />
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

async function collectSelfChannelDiagnostics({ browserPubkey, operatorPubkey, temporaryChannelId }) {
  const [browserPeers, browserChannels, operatorDiagnostics] = await Promise.allSettled([
    browserListPeers(),
    browserListChannels(),
    requestBrowserDiagnostics(browserPubkey, temporaryChannelId),
  ])

  const browserPeerList = browserPeers.status === 'fulfilled' ? browserPeers.value?.peers || [] : []
  const browserChannelList = browserChannels.status === 'fulfilled' ? browserChannels.value?.channels || [] : []
  const normalizedOperator = normalizePubkey(operatorPubkey)
  const browserOperatorChannels = browserChannelList.filter((channel) => normalizePubkey(channel.pubkey) === normalizedOperator)
  const browserMatchingChannel = temporaryChannelId
    ? browserChannelList.find((channel) => String(channel.channel_id || '').toLowerCase() === temporaryChannelId.toLowerCase())
    : null

  const diagnostics = {
    diagnosticCheckedAt: new Date().toISOString(),
    browserPeerCount: browserPeerList.length,
    browserSeesOperatorPeer: browserPeerList.some((peer) => normalizePubkey(peer.pubkey) === normalizedOperator),
    browserTemporaryChannelState: browserMatchingChannel ? `${channelStateName(browserMatchingChannel)} / ${browserMatchingChannel.state?.state_flags || browserMatchingChannel.state_flags || 'no flags'}` : 'Not visible in browser list_channels',
    browserOperatorChannelsSummary: summarizeChannels(browserOperatorChannels),
    operatorDiagnostics: operatorDiagnostics.status === 'fulfilled' ? operatorDiagnostics.value : null,
    diagnosticError: [
      browserPeers.status === 'rejected' ? `browser peers: ${browserPeers.reason?.message || browserPeers.reason}` : '',
      browserChannels.status === 'rejected' ? `browser channels: ${browserChannels.reason?.message || browserChannels.reason}` : '',
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

async function waitForSelfFundedChannel(operatorPubkey, requiredBaseUnits, onUpdate) {
  let latestChannels = null
  let senderRoute = null

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (attempt > 0) await wait(5000)
    latestChannels = await browserListChannels()
    senderRoute = findSenderRouteChannel(latestChannels, operatorPubkey, requiredBaseUnits)
    const pendingChannels = pendingOperatorChannels(latestChannels, operatorPubkey)
    onUpdate?.({
      readyChannel: senderRoute.channel,
      latestLocalBalance: senderRoute.largestLocalBalance.toString(),
      pendingChannels,
      fundedPendingChannel: pendingChannels.find((channel) => channel.channel_outpoint) || null,
      senderRouteDiagnostics: describeSenderRouteChannels(latestChannels, operatorPubkey),
    })
    if (senderRoute.channel) break
  }

  return {
    latestChannels,
    channel: senderRoute?.channel || null,
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
      throw new Error(`${temporaryChannelId}: ${error.message || String(error)}`)
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

  const refreshUser = useCallback(async () => {
    const result = await api('/me')
    setUser(result.user)
    return result.user
  }, [])

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
    if (peersResult.status === 'fulfilled') {
      setPeers(peersResult.value)
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

  const registerDevice = useCallback(async (pubkey) => {
    const result = await api('/fiber/register-device', {
      method: 'POST',
      body: JSON.stringify({ fiberPubkey: pubkey }),
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

    try {
      await registerDevice(info.pubkey)
    } catch (error) {
      startupWarnings.push(`Could not sync your phone registry: ${error.message || 'request failed'}`)
    }

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
  }, [refreshNetwork, registerDevice])

  async function createWallet(pin, confirmPin) {
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
    } catch (error) {
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
    localStorage.removeItem('dular_token')
    setNodeInfo(null)
    setOperatorInfo(null)
    setPeers({ peers: [] })
    setChannels({ channels: [] })
    setFunding(null)
    setNetworkStatus(null)
    setLastNetworkRefreshAt('')
    setWalletStatus('idle')
    setUser(null)
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

  async function resetLocalWallet() {
    if (!user) return
    await stopBrowserFiber()
    runtimeRef.current = null
    await deleteWalletRecord(user.phone)
    setWalletRecord(null)
    setNodeInfo(null)
    setOperatorInfo(null)
    setPeers({ peers: [] })
    setChannels({ channels: [] })
    setFunding(null)
    setNetworkStatus(null)
    setLastNetworkRefreshAt('')
    setWalletStatus('idle')
    setSetupStatus({ type: 'success', message: 'Local wallet deleted from this device. You can create a new one now.' })
  }

  useEffect(() => {
    let active = true
    async function boot() {
      if (!token()) {
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
        localStorage.removeItem('dular_token')
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
    return <AuthGate onAuth={setUser} />
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
            onCreate={createWallet}
            onUnlock={unlockWallet}
            loading={['creating', 'unlocking', 'starting'].includes(walletStatus)}
            status={setupStatus}
          />
          <div className="buttonRow wrapButtons">
            <button type="button" className="secondaryBtn" onClick={signOut}>Sign out</button>
            {walletRecord && <button type="button" className="dangerBtn" onClick={resetLocalWallet}>Reset device wallet</button>}
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
