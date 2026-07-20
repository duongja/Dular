import { useCallback, useEffect, useRef, useState } from 'react'
import {
  browserAcceptChannel,
  browserConnectPeer,
  browserCreateInvoice,
  browserGetPayment,
  browserListChannels,
  browserListPeers,
  browserNodeInfo,
  browserSendPayment,
  canUseBrowserFiber,
  startBrowserFiber,
  stopBrowserFiber,
} from './lib/fiberBrowserNode.js'
import {
  createWalletRecord,
  deleteWalletRecord,
  loadWalletRecord,
  unlockWalletRecord,
} from './lib/browserWalletStore.js'
import './App.css'

const RUSD_BASE = 100000000n

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
  return <div className={`statusMessage ${state.type}`}>{state.message}</div>
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

function scrollToPanel(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
    <section className="flowHero selfCustodyHero">
      <p className="eyebrow">Dular self-custody</p>
      <h1>Mobile money simplicity. Fiber under the hood.</h1>
      <p>
        Your phone number identifies you. Your keys stay on this device. Dular handles the network steps in the background.
      </p>
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
      setStatus({ type: 'success', message: 'Code sent. Continue to unlock or create your device wallet.' })
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
            <h2>Enter your phone</h2>
            <p className="muted">Use the same number you use for mobile money. This is how people find you on Dular.</p>
            <div className="formGroup">
              <label>Phone number</label>
              <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0712 345 678" required />
            </div>
            <button type="submit" className="primaryBtn fullWidth" disabled={loading}>{loading ? 'Sending code...' : 'Send secure code'}</button>
          </form>
        ) : (
          <form onSubmit={verifyOtp}>
            <span className="stepPill">Step 2 of 2</span>
            <h2>Confirm it is you</h2>
            <p className="muted">Enter the 6-digit code sent to {phone}. {demoCode ? `Use code ${demoCode} for local testing.` : ''}</p>
            <div className="formGroup">
              <label>Secure code</label>
              <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="123456" required />
            </div>
            <div className="buttonRow">
              <button type="button" className="secondaryBtn" onClick={() => setStep('phone')}>Change number</button>
              <button type="submit" className="primaryBtn" disabled={loading}>{loading ? 'Verifying...' : 'Open wallet'}</button>
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
        <p className="eyebrow">Wallet security</p>
        <h1>{hasExistingWallet ? 'Unlock your wallet' : 'Create your device wallet'}</h1>
        <p className="muted">
          This PIN protects the wallet stored in this browser. Keep this device and PIN safe; clearing browser data can remove this test wallet.
        </p>
        {hasExistingWallet ? (
          <form onSubmit={unlockWallet}>
            <div className="formGroup">
              <label>Wallet PIN</label>
              <input type="password" value={pin} onChange={(event) => setPin(event.target.value)} placeholder="4+ digits" required />
            </div>
            <button type="submit" className="primaryBtn fullWidth" disabled={loading}>{loading ? 'Unlocking...' : `Unlock ${phone}`}</button>
          </form>
        ) : (
          <form onSubmit={createWallet}>
            <div className="formGroup">
              <label>Create wallet PIN</label>
              <input type="password" value={pin} onChange={(event) => setPin(event.target.value)} placeholder="4+ digits" required />
            </div>
            <div className="formGroup">
              <label>Confirm PIN</label>
              <input type="password" value={confirmPin} onChange={(event) => setConfirmPin(event.target.value)} placeholder="Repeat PIN" required />
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
  const readyChannels = (channels?.channels || []).filter(isReadyChannel)
  const spendableBaseUnits = sumChannelBalance(readyChannels)
  const spendableBalance = formatRUsd(spendableBaseUnits)
  const walletAddress = funding?.address || ''

  return (
    <main className="appShell">
      <header className="appTopbar">
        <div className="brandLockup">
          <div className="brandMark small">D</div>
          <div>
            <strong>Dular</strong>
            <span>{user.phone}</span>
          </div>
        </div>
        <div className={`connectionBadge ${walletStatus === 'ready' ? '' : 'syncing'}`}>
          <span />
          {walletStatus === 'ready' ? 'Live' : walletStatus}
        </div>
      </header>

      <section className="phoneFrame">
        <div className="screenStack">
          <section className="balanceCard walletBalanceCard">
            <div className="balanceTopline">
              <span>Available to send</span>
              <button type="button" className="ghostBtn" onClick={() => onRefreshNetwork()} disabled={refreshingNetwork}>
                {refreshingNetwork ? 'Checking...' : 'Sync'}
              </button>
            </div>
            <strong>{spendableBalance}</strong>
            <p>
              Use Dular like a mobile money wallet. The keys stay on this phone, and Fiber handles settlement behind the scenes.
            </p>
            {lastNetworkRefreshAt && (
              <p className="balanceMeta">Last checked {lastNetworkRefreshAt}</p>
            )}
            <Status state={networkStatus} />
            <div className="quickActions walletActions">
              <button type="button" onClick={() => scrollToPanel('add-funds')}>
                <span>+</span>
                Add
              </button>
              <button type="button" onClick={() => scrollToPanel('receive')}>
                <span>in</span>
                Receive
              </button>
              <button type="button" onClick={() => scrollToPanel('send')}>
                <span>out</span>
                Send
              </button>
            </div>
          </section>

          <section className="contentCard walletIdentityCard">
            <div className="sectionHeader">
              <div>
                <p className="eyebrow">Your wallet</p>
                <h2>{user.phone}</h2>
              </div>
              <span className="safePill">Keys on device</span>
            </div>
            <div className="walletSummaryGrid">
              <div>
                <span>Status</span>
                <strong>{readyChannels.length ? 'Ready' : 'Needs funds'}</strong>
              </div>
              <div>
                <span>Channels</span>
                <strong>{readyChannels.length}</strong>
              </div>
              <div>
                <span>Peers</span>
                <strong>{peers?.peers?.length || 0}</strong>
              </div>
            </div>
            <ProofDrawer summary="Wallet proof and network details">
              <ProofRow label="Phone" value={user.phone} />
              <ProofRow label="Wallet pubkey" value={user.fiberPubkey || nodeInfo?.pubkey || 'Pending'} />
              <ProofRow label="Wallet address" value={walletAddress || 'Loading...'} />
              <ProofRow label="Node pubkey" value={nodeInfo?.pubkey || 'Not loaded'} />
              <ProofRow label="Addresses" value={nodeInfo?.addresses?.join(', ') || 'Not advertised'} />
              <ProofRow label="Wallet CKB capacity" value={funding?.capacity || 'Unknown'} />
            </ProofDrawer>
          </section>

          <section id="add-funds" className="contentCard mobileActionCard">
            <div className="sectionHeader">
              <div>
                <p className="eyebrow">Add money</p>
                <h2>Add test funds</h2>
              </div>
            </div>
            <p className="muted">
              For this testnet build, fund this browser wallet with testnet CKB from the faucet, then add RUSD to spend in the app.
            </p>
            <div className="buttonRow wrapButtons">
              <a
                className="secondaryBtn"
                href="https://faucet.nervos.org/"
                target="_blank"
                rel="noreferrer"
              >
                Open CKB faucet
              </a>
              {walletAddress && <CopyButton value={walletAddress} label="Copy address" />}
            </div>
            <TopUpCard nodeInfo={nodeInfo} onRefreshNetwork={onRefreshNetwork} />
          </section>

          <section id="receive" className="contentCard mobileActionCard">
            <div className="sectionHeader">
              <div>
                <p className="eyebrow">Receive</p>
                <h2>Ask for RUSD</h2>
              </div>
            </div>
            <ReceiveCard nodeInfo={nodeInfo} onRefreshNetwork={onRefreshNetwork} />
          </section>

          <section id="send" className="contentCard mobileActionCard">
            <div className="sectionHeader">
              <div>
                <p className="eyebrow">Send</p>
                <h2>Pay a request</h2>
              </div>
            </div>
            <PayInvoiceCard />
          </section>

          <section id="wallet-safety" className="contentCard safetyCard">
            <div className="sectionHeader">
              <div>
                <p className="eyebrow">Safety</p>
                <h2>Keep control</h2>
              </div>
            </div>
            <div className="safetyList">
              <span>Your wallet keys stay in this browser.</span>
              <span>Keep this tab open while sending or receiving.</span>
              <span>Do not clear browser data for this test wallet.</span>
            </div>
            <div className="buttonRow wrapButtons">
              <button type="button" className="secondaryBtn" onClick={onLock}>Lock wallet</button>
              <button type="button" className="secondaryBtn" onClick={onSignOut}>Sign out</button>
            </div>
          </section>
        </div>
      </section>
      <nav className="bottomNav" aria-label="Wallet actions">
        <button type="button" onClick={() => scrollToPanel('add-funds')}>
          <span>+</span>
          Add
        </button>
        <button type="button" onClick={() => scrollToPanel('receive')}>
          <span>in</span>
          Receive
        </button>
        <button type="button" onClick={() => scrollToPanel('send')}>
          <span>out</span>
          Send
        </button>
        <button type="button" onClick={() => scrollToPanel('wallet-safety')}>
          <span>ok</span>
          Safety
        </button>
      </nav>
    </main>
  )
}

function TopUpCard({ nodeInfo, onRefreshNetwork }) {
  const [amount, setAmount] = useState('1.00')
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [proof, setProof] = useState(null)

  async function submit(event) {
    event.preventDefault()
    if (!nodeInfo?.pubkey) {
      setStatus({ type: 'error', message: 'Wallet is still starting. Wait a few seconds and try again.' })
      return
    }

    setLoading(true)
    setStatus(null)
    setProof(null)

    try {
      const fundingAmountBaseUnits = toBaseUnits(amount).toString()
      setStatus({ type: 'warning', message: 'Creating a secure receive request for your top-up...' })
      const invoice = await browserCreateInvoice({
        amountHex: toBaseUnitsHex(amount),
        description: 'Dular test RUSD top-up',
      })
      setProof({ invoice })

      let result = await requestSeedLiquidity(invoice.invoice_address, nodeInfo.pubkey, nodeInfo.addresses || [], { fundingAmountBaseUnits })
      setProof((current) => ({ ...(current || {}), ...result, invoice }))

      if (result.nextAction === 'accept_channel') {
        setStatus({ type: 'warning', message: 'Approving the incoming Fiber channel on this device...' })
        let accepted
        try {
          accepted = await acceptPendingChannel(result)
        } catch (error) {
          if (!isMissingTempChannelError(error)) throw error
          setStatus({ type: 'warning', message: 'Refreshing a stale channel request and trying again...' })
          result = await requestSeedLiquidity(invoice.invoice_address, nodeInfo.pubkey, nodeInfo.addresses || [], { replacePending: true, fundingAmountBaseUnits })
          setProof((current) => ({ ...(current || {}), ...result, invoice }))
          accepted = await acceptPendingChannel(result)
        }
        if (!accepted.length) {
          throw new Error('No incoming channel reached this wallet yet. Keep this tab open, sync the wallet, then try again.')
        }
        setStatus({ type: 'warning', message: 'Channel accepted. Waiting for the RUSD top-up to finish...' })
        await onRefreshNetwork({ silent: true })
        result = await retrySeedLiquidity(invoice.invoice_address, nodeInfo.pubkey, nodeInfo.addresses || [], { fundingAmountBaseUnits })
        setProof((current) => ({ ...(current || {}), ...result, acceptedChannels: accepted, invoice }))
      }

      await onRefreshNetwork({ silent: true })
      setStatus({
        type: result.payment ? 'success' : 'warning',
        message: result.payment
          ? `${formatRUsd(fundingAmountBaseUnits)} added. You can now send from this wallet.`
          : 'The channel is accepted, but the RUSD top-up is still settling. Keep this wallet open and sync again shortly.',
      })
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Could not add test RUSD.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="topUpPanel">
      <form onSubmit={submit}>
        <div className="formGroup">
          <label>Amount to add</label>
          <div className="amountField">
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="1.00" required />
            <span>RUSD</span>
          </div>
        </div>
        <button type="submit" className="primaryBtn fullWidth" disabled={loading || !nodeInfo?.pubkey}>
          {loading ? 'Adding funds...' : 'Add test RUSD'}
        </button>
      </form>
      <Status state={status} />
      {proof && (
        <ProofDrawer summary="Top-up proof">
          {proof.invoice?.invoice_address && <ProofRow label="Invoice" value={proof.invoice.invoice_address} />}
          {proof.invoice?.payment_hash && <ProofRow label="Payment hash" value={proof.invoice.payment_hash} />}
          {proof.channelBootstrap?.temporary_channel_id && <ProofRow label="Bootstrap channel" value={proof.channelBootstrap.temporary_channel_id} />}
          {proof.readyChannel?.channel_id && <ProofRow label="Ready channel" value={proof.readyChannel.channel_id} />}
          {proof.payment?.payment_hash && <ProofRow label="Operator payment" value={proof.payment.payment_hash} />}
          {proof.acceptedChannels?.length > 0 && <ProofRow label="Accepted channels" value={proof.acceptedChannels.map((channel) => channel.channelId).join(', ')} />}
          {proof.pendingChannels?.length > 0 && <ProofRow label="Pending channels" value={proof.pendingChannels.map((channel) => `${channel.channel_id}:${channelStateName(channel)}`).join(', ')} />}
          {proof.outboundLiquidity && <ProofRow label="Operator outbound" value={formatRUsd(proof.outboundLiquidity)} />}
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

  async function prepareReceivingRoute({ manageLoading = true } = {}) {
    if (!nodeInfo?.pubkey) return
    if (manageLoading) setLoading(true)
    setStatus(null)

    try {
      const fundingAmountBaseUnits = toBaseUnits(amount).toString()
      let result = await requestReceiveRoute(nodeInfo.pubkey, nodeInfo.addresses || [], { fundingAmountBaseUnits })
      setBootstrap(result)

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
      }

      await onRefreshNetwork({ silent: true })
      setStatus({
        type: result.hopHints?.length ? 'success' : 'warning',
        message: result.hopHints?.length
          ? 'Ready to receive. Share this request with the sender.'
          : 'Request created, but the receive route is still becoming ready. Keep this wallet open and tap Prepare again shortly.',
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
      <form onSubmit={submit}>
        <div className="formGroup">
          <label>Amount to receive</label>
          <div className="amountField">
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="1.00" required />
            <span>RUSD</span>
          </div>
        </div>
        <div className="formGroup">
          <label>Note</label>
          <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Payment request" required />
        </div>
        <button type="submit" className="primaryBtn fullWidth" disabled={loading || !nodeInfo?.pubkey}>
          {loading ? 'Preparing request...' : 'Create payment request'}
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
              {loading ? 'Preparing...' : 'Prepare again'}
            </button>
          </div>
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
              {bootstrap.outboundLiquidity && <ProofRow label="Operator outbound" value={formatRUsd(bootstrap.outboundLiquidity)} />}
              {bootstrap.requiredOutboundLiquidity && <ProofRow label="Required outbound" value={formatRUsd(bootstrap.requiredOutboundLiquidity)} />}
              {bootstrap.connectError && <ProofRow label="Connect note" value={bootstrap.connectError} />}
            </ProofDrawer>
          )}
        </div>
      )}
    </>
  )
}

async function requestSeedLiquidity(invoice, pubkey, addresses, options = {}) {
  return api('/fiber/browser/seed-liquidity', {
    method: 'POST',
    body: JSON.stringify({ invoice, pubkey, addresses, ...options }),
  })
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

async function retrySeedLiquidity(invoice, pubkey, addresses, options = {}) {
  let result = null
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (attempt > 0) await wait(5000)
    result = await requestSeedLiquidity(invoice, pubkey, addresses, options)
    if (result.payment || result.readyChannel) return result
  }
  return result
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

function PayInvoiceCard() {
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
        throw new Error('No spendable RUSD is ready yet. Use Add test funds first, keep the wallet open, then try sending again.')
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
          `Not enough ready RUSD to send this payment. Needed ${formatRUsd(requiredOutbound)}, available route balance is ${formatRUsd(senderRoute.largestLocalBalance)}. Use Add test funds, wait for sync, then retry.`,
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
    } catch (error) {
      setStatus({ type: 'error', message: errorMessage(error, 'Could not refresh payment.') })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <form onSubmit={submit}>
        <div className="formGroup">
          <label>Payment request</label>
          <textarea
            className="textAreaField"
            value={invoice}
            onChange={(event) => setInvoice(event.target.value)}
            placeholder="Paste the request from the receiver"
            required
          />
        </div>
        <div className="buttonRow wrapButtons">
          <button type="submit" className="primaryBtn fullWidth" disabled={loading}>
            {loading ? 'Sending payment...' : 'Send RUSD'}
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
            <button type="button" className="secondaryBtn" onClick={refreshPayment} disabled={loading}>Refresh payment</button>
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

    const [infoResult, peersResult, channelsResult] = await Promise.allSettled([
      browserNodeInfo(),
      browserListPeers(),
      browserListChannels(),
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
        <div className="brandMark">D</div>
        <p>Opening self-custody wallet...</p>
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
          <h2>Browser wallet not ready</h2>
          <p className="muted">
            This wallet needs a secure, cross-origin isolated browser context before the Fiber runtime can start. Use the local Vite server or the updated deployment headers for this path.
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
            {walletRecord && <button type="button" className="secondaryBtn" onClick={resetLocalWallet}>Reset local wallet</button>}
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
    />
  )
}
