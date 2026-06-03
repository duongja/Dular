import { useCallback, useEffect, useRef, useState, startTransition } from 'react'
import './App.css'

const RUSD_BASE = 100000000n
const ACTIVE_DEPOSIT_STATUSES = new Set(['initiating', 'pending', 'mpesa_paid_fiber_pending'])

const NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'deposit', label: 'Deposit', icon: '+' },
  { id: 'send', label: 'Send', icon: '→' },
  { id: 'withdraw', label: 'Withdraw', icon: '↓' },
  { id: 'account', label: 'Account', icon: '•' },
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

function formatKes(value) {
  return Number(value || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

function toBaseUnits(value) {
  const raw = String(value || '').trim()
  if (!/^\d+(\.\d{1,8})?$/.test(raw)) throw new Error('Enter a valid RUSD amount')
  const [whole, fraction = ''] = raw.split('.')
  return (BigInt(whole) * RUSD_BASE + BigInt(fraction.padEnd(8, '0'))).toString()
}

function shortId(value = '', head = 10) {
  if (!value) return ''
  if (value.length <= head * 2) return value
  return `${value.slice(0, head)}...${value.slice(-head)}`
}

function isActiveDeposit(tx) {
  return tx.kind === 'deposit' && ACTIVE_DEPOSIT_STATUSES.has(tx.status) && tx.fiber_status !== 'ActionRequired'
}

function transactionStage(tx) {
  if (tx.kind === 'phone_send') {
    return { label: 'Sent', detail: `Sent to ${tx.phone || 'Dular user'}.`, tone: 'success', step: 3 }
  }
  if (tx.kind === 'phone_receive') {
    return { label: 'Received', detail: `Received from ${tx.phone || 'Dular user'}.`, tone: 'success', step: 3 }
  }

  if (tx.kind === 'withdrawal') {
    if (tx.status === 'completed') return { label: 'Paid out', detail: 'Cash sent to your M-Pesa number.', tone: 'success', step: 3 }
    if (tx.status === 'failed') return { label: 'Failed', detail: 'The cash-out did not complete.', tone: 'error', step: 1 }
    return { label: 'Cash-out pending', detail: 'We are sending the payout to M-Pesa.', tone: 'pending', step: 2 }
  }

  if (tx.status === 'initiating') {
    return { label: 'Starting deposit', detail: 'Preparing your M-Pesa request.', tone: 'pending', step: 1 }
  }
  if (tx.status === 'pending') {
    return { label: 'Waiting for M-Pesa', detail: 'Approve the prompt on your phone.', tone: 'pending', step: 1 }
  }
  if (tx.status === 'mpesa_paid_fiber_pending') {
    if (tx.fiber_status === 'ActionRequired') {
      return { label: 'Action needed', detail: 'M-Pesa was received, but the RUSD channel needs more liquidity before your balance can be secured.', tone: 'error', step: 2 }
    }
    return { label: 'Finalizing deposit', detail: 'Payment received. Securing your RUSD balance now.', tone: 'settling', step: 2 }
  }
  if (tx.status === 'completed') {
    return { label: 'Completed', detail: 'Your RUSD balance has been updated.', tone: 'success', step: 3 }
  }
  if (tx.status === 'failed') {
    return { label: 'Failed', detail: 'The M-Pesa request failed or expired.', tone: 'error', step: 1 }
  }

  return { label: 'Processing', detail: 'We are checking the latest status.', tone: 'pending', step: 1 }
}

function Status({ state }) {
  if (!state) return null
  return <div className={`statusMessage ${state.type}`}>{state.message}</div>
}

function MoneyInput({ label, value, onChange, placeholder = '100', currency = 'KES', hint }) {
  return (
    <div className="formGroup">
      <label>{label}</label>
      <div className="amountField">
        <input
          inputMode="decimal"
          min="1"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required
        />
        <span>{currency}</span>
      </div>
      {hint && <p className="inputHint">{hint}</p>}
    </div>
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
      setStatus({ type: 'success', message: 'Code sent. Check your SMS messages.' })
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
      <section className="authHero">
        <div className="brandMark">D</div>
        <p className="eyebrow">Mobile money, upgraded</p>
        <h1>Stable money for the phone number you already use.</h1>
        <p>
          Deposit from M-Pesa, hold RUSD, send to people by phone number, and cash out when you need local money.
        </p>
      </section>

      <section className="authPanel">
        {step === 'phone' ? (
          <form onSubmit={requestOtp}>
            <span className="stepPill">Step 1 of 2</span>
            <h2>Enter your M-Pesa number</h2>
            <p className="muted">We use this number to protect your wallet and send payment prompts.</p>
            <div className="formGroup">
              <label>Phone number</label>
              <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0712 345 678" required />
            </div>
            <button type="submit" className="primaryBtn fullWidth" disabled={loading}>{loading ? 'Sending code...' : 'Continue'}</button>
          </form>
        ) : (
          <form onSubmit={verifyOtp}>
            <span className="stepPill">Step 2 of 2</span>
            <h2>Confirm it is you</h2>
            <p className="muted">Enter the 6-digit code sent to {phone}. {demoCode ? `Demo code: ${demoCode}` : ''}</p>
            <div className="formGroup">
              <label>Verification code</label>
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

function BalanceCard({ user, syncing, lastSyncedAt, onRefresh }) {
  return (
    <section className="balanceCard">
      <div className="balanceTopline">
        <span>Available balance</span>
        <button type="button" className="ghostBtn" onClick={onRefresh}>Refresh</button>
      </div>
      <strong>{formatRUsd(user.balanceBaseUnits)}</strong>
      <p>{syncing ? 'Updating your latest payments...' : lastSyncedAt ? `Updated ${lastSyncedAt.toLocaleTimeString()}` : 'Connected to your wallet'}</p>
    </section>
  )
}

function HomeScreen({ user, transactions, syncing, lastSyncedAt, onRefresh, setTab }) {
  const latest = transactions.slice(0, 4)
  const active = transactions.find(isActiveDeposit)

  return (
    <div className="screenStack">
      <BalanceCard user={user} syncing={syncing} lastSyncedAt={lastSyncedAt} onRefresh={onRefresh} />

      {active && (
        <section className="liveStatusCard">
          <div>
            <span className="eyebrow">In progress</span>
            <h2>{transactionStage(active).label}</h2>
            <p>{transactionStage(active).detail}</p>
          </div>
          <button type="button" className="secondaryBtn" onClick={() => setTab('activity')}>Track</button>
        </section>
      )}

      <section className="quickActions">
        <button type="button" onClick={() => setTab('deposit')}>
          <span>+</span>
          Deposit
        </button>
        <button type="button" onClick={() => setTab('send')}>
          <span>→</span>
          Send
        </button>
        <button type="button" onClick={() => setTab('withdraw')}>
          <span>↓</span>
          Withdraw
        </button>
      </section>

      <section className="contentCard">
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">Recent activity</p>
            <h2>Payments</h2>
          </div>
          <button type="button" className="ghostBtn" onClick={() => setTab('activity')}>View all</button>
        </div>
        <ActivityList rows={latest} compact />
      </section>
    </div>
  )
}

function DepositFlow({ onCreated }) {
  const [amountKes, setAmountKes] = useState('')
  const [generatedInvoice, setGeneratedInvoice] = useState(null)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setLoading(true)
    setStatus(null)
    setGeneratedInvoice(null)

    try {
      const invoice = await api('/fiber/receiver/invoice', {
        method: 'POST',
        body: JSON.stringify({ amountKes }),
      })
      const paymentHash = invoice.paymentHash || invoice.payment_hash || invoice.invoice?.data?.payment_hash
      if (!paymentHash) throw new Error('Could not prepare the payment request. Please try again.')
      setGeneratedInvoice(invoice)

      const result = await api('/mpesa/deposit', {
        method: 'POST',
        body: JSON.stringify({
          amountKes,
          fiberInvoice: invoice.invoice,
          fiberInvoicePaymentHash: paymentHash,
        }),
      })

      setAmountKes('')
      await onCreated(result.transaction)
      setStatus({ type: 'success', message: 'M-Pesa prompt sent. Approve it on your phone and this screen will update automatically.' })
    } catch (error) {
      setStatus({ type: 'error', message: error.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="screenStack">
      <section className="flowHero deposit">
        <p className="eyebrow">Add money</p>
        <h1>Deposit from M-Pesa</h1>
        <p>Enter an amount, approve the STK prompt on your phone, and receive RUSD in your wallet.</p>
      </section>

      <section className="contentCard">
        <form onSubmit={submit}>
          <MoneyInput
            label="How much do you want to deposit?"
            value={amountKes}
            onChange={setAmountKes}
            hint={amountKes ? `You will receive ${formatKes(amountKes)} RUSD after confirmation.` : 'Minimum KES 1.'}
          />
          <button type="submit" className="primaryBtn fullWidth" disabled={loading || !amountKes}>
            {loading ? 'Sending M-Pesa prompt...' : 'Continue to M-Pesa'}
          </button>
        </form>
        <Status state={status} />
        <StatusTimeline state={loading ? 'pending' : status?.type === 'success' ? 'sent' : 'idle'} />
        {generatedInvoice && (
          <details className="proofDrawer">
            <summary>Proof details</summary>
            <ProofRow label="Receiver proof" value={generatedInvoice.paymentHash} />
            <ProofRow label="Amount" value={formatRUsd(generatedInvoice.amountBaseUnits)} />
          </details>
        )}
      </section>
    </div>
  )
}

function StatusTimeline({ state }) {
  const steps = [
    { id: 'prompt', label: 'M-Pesa prompt' },
    { id: 'confirm', label: 'Payment confirmed' },
    { id: 'credit', label: 'Balance updated' },
  ]
  const activeIndex = state === 'idle' ? -1 : state === 'sent' ? 1 : 0

  return (
    <div className="timeline">
      {steps.map((step, index) => (
        <div className={`timelineStep ${index <= activeIndex ? 'active' : ''}`} key={step.id}>
          <span>{index + 1}</span>
          <p>{step.label}</p>
        </div>
      ))}
    </div>
  )
}

function SendFlow({ onDone }) {
  const [phone, setPhone] = useState('')
  const [amount, setAmount] = useState('')
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setLoading(true)
    setStatus(null)
    try {
      const result = await api('/payments/send-phone', {
        method: 'POST',
        body: JSON.stringify({ phone, amountBaseUnits: toBaseUnits(amount) }),
      })
      setPhone('')
      setAmount('')
      setStatus({ type: 'success', message: `Sent successfully to ${result.recipient.phone}.` })
      await onDone()
    } catch (error) {
      setStatus({ type: 'error', message: error.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="screenStack">
      <section className="flowHero send">
        <p className="eyebrow">Send money</p>
        <h1>Pay a phone number</h1>
        <p>Send RUSD to another verified Dular user without copying wallet addresses.</p>
      </section>
      <section className="contentCard">
        <form onSubmit={submit}>
          <div className="formGroup">
            <label>Recipient phone number</label>
            <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0712 345 678" required />
          </div>
          <MoneyInput
            label="Amount to send"
            value={amount}
            onChange={setAmount}
            placeholder="1.00"
            currency="RUSD"
            hint="The recipient receives RUSD instantly in their Dular wallet."
          />
          <button type="submit" className="primaryBtn fullWidth" disabled={loading}>{loading ? 'Sending...' : 'Send payment'}</button>
        </form>
        <Status state={status} />
      </section>
    </div>
  )
}

function WithdrawFlow({ onDone, balanceBaseUnits }) {
  const [amountKes, setAmountKes] = useState('')
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setLoading(true)
    setStatus(null)
    try {
      const result = await api('/mpesa/withdraw', {
        method: 'POST',
        body: JSON.stringify({ amountKes }),
      })
      setAmountKes('')
      setStatus({ type: 'success', message: `Cash-out started. Reference: ${shortId(result.transaction.id, 8)}` })
      await onDone()
    } catch (error) {
      setStatus({ type: 'error', message: error.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="screenStack">
      <section className="flowHero withdraw">
        <p className="eyebrow">Cash out</p>
        <h1>Withdraw to M-Pesa</h1>
        <p>Convert your RUSD balance back to KES and receive it on your verified phone number.</p>
      </section>
      <section className="contentCard">
        <div className="availableLine">
          <span>Available</span>
          <strong>{formatRUsd(balanceBaseUnits)}</strong>
        </div>
        <form onSubmit={submit}>
          <MoneyInput
            label="Amount to withdraw"
            value={amountKes}
            onChange={setAmountKes}
            hint="Your RUSD balance is debited when the cash-out request starts."
          />
          <button type="submit" className="primaryBtn fullWidth" disabled={loading}>{loading ? 'Starting cash-out...' : 'Withdraw to M-Pesa'}</button>
        </form>
        <Status state={status} />
      </section>
    </div>
  )
}

function ActivityList({ rows, compact = false }) {
  if (rows.length === 0) {
    return <div className="emptyState">No payments yet. Your deposits, sends, and withdrawals will appear here.</div>
  }

  return (
    <div className={`activityList ${compact ? 'compact' : ''}`}>
      {rows.map((tx) => (
        <ActivityItem tx={tx} key={tx.id} />
      ))}
    </div>
  )
}

function ActivityItem({ tx }) {
  const stage = transactionStage(tx)
  const direction = ['deposit', 'phone_receive'].includes(tx.kind) ? '+' : '-'
  const title = tx.kind === 'deposit'
    ? 'M-Pesa deposit'
    : tx.kind === 'withdrawal'
      ? 'M-Pesa withdrawal'
      : tx.kind === 'phone_receive'
        ? 'Dular payment received'
        : 'Dular payment sent'

  return (
    <article className={`activityItem ${stage.tone}`}>
      <div className="activityIcon">{tx.kind === 'deposit' ? '+' : tx.kind === 'withdrawal' ? '↓' : tx.kind === 'phone_receive' ? '←' : '→'}</div>
      <div className="activityBody">
        <div className="activityTop">
          <div>
            <strong>{title}</strong>
            <p>{stage.label}</p>
          </div>
          <div className="activityAmount">
            <strong>{direction}{formatRUsd(tx.rusd_base_units, true)}</strong>
            <span>RUSD</span>
          </div>
        </div>
        <div className="activityMeta">
          <span>{tx.kes_amount ? `KES ${formatKes(tx.kes_amount)}` : tx.phone ? stage.detail : 'Dular transfer'}</span>
          <span>{new Date(tx.created_at).toLocaleString()}</span>
        </div>
        <details className="proofDrawer compactProof">
          <summary>Proof details</summary>
          <ProofRow label="Status" value={tx.status} />
          {tx.provider_payload?.sourceId && <ProofRow label="Transfer ID" value={tx.provider_payload.sourceId} />}
          {tx.provider_payload?.counterpartyPhone && <ProofRow label="Phone" value={tx.provider_payload.counterpartyPhone} />}
          {tx.checkout_request_id && <ProofRow label="M-Pesa checkout" value={tx.checkout_request_id} />}
          {tx.receipt_number && <ProofRow label="M-Pesa receipt" value={tx.receipt_number} />}
          {tx.fiber_payment_hash && <ProofRow label="Fiber payment" value={tx.fiber_payment_hash} />}
          {tx.fiber_status && <ProofRow label="Network status" value={tx.fiber_status} />}
        </details>
      </div>
    </article>
  )
}

function ActivityScreen({ transactions }) {
  return (
    <div className="screenStack">
      <section className="sectionHeader loose">
        <div>
          <p className="eyebrow">Wallet history</p>
          <h1>Activity</h1>
        </div>
      </section>
      <section className="contentCard">
        <ActivityList rows={transactions} />
      </section>
    </div>
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

function AccountScreen({ user, onSignOut }) {
  const [phone, setPhone] = useState('')
  const [lookup, setLookup] = useState(null)
  const [status, setStatus] = useState(null)

  async function submit(event) {
    event.preventDefault()
    setStatus(null)
    setLookup(null)
    try {
      const data = await api(`/registry/lookup?phone=${encodeURIComponent(phone)}`)
      setLookup(data)
    } catch (error) {
      setStatus({ type: 'error', message: error.message })
    }
  }

  return (
    <div className="screenStack">
      <section className="contentCard accountCard">
        <div className="profileBadge">{user.phone.slice(-2)}</div>
        <p className="eyebrow">Your Dular account</p>
        <h1>{user.phone}</h1>
        <p>Your phone number is verified and ready for M-Pesa deposits, transfers, and withdrawals.</p>
        <button type="button" className="secondaryBtn" onClick={onSignOut}>Sign out</button>
      </section>

      <section className="contentCard">
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">Advanced</p>
            <h2>Verification tools</h2>
          </div>
        </div>
        <p className="muted">Use this when you need to prove a phone number is linked to a Dular network identity.</p>
        <form onSubmit={submit} className="lookupForm">
          <div className="formGroup">
            <label>Phone number</label>
            <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0712 345 678" required />
          </div>
          <button type="submit" className="secondaryBtn">Lookup</button>
        </form>
        <Status state={status} />
        {lookup && (
          <div className="proofPanel">
            <ProofRow label="Phone" value={lookup.phone} />
            <ProofRow label="Network identity" value={lookup.fiberPubkey || 'Pending'} />
          </div>
        )}
      </section>
    </div>
  )
}

function WalletApp({ user, onRefresh, onSignOut }) {
  const [tab, setTab] = useState('home')
  const [transactions, setTransactions] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState(null)
  const reconcileInFlight = useRef(new Set())

  const refreshTransactions = useCallback(async () => {
    const result = await api('/transactions')
    setTransactions(result.transactions || [])
    return result.transactions || []
  }, [])

  const reconcileTransactions = useCallback(async (rows) => {
    const activeRows = rows.filter((tx) => isActiveDeposit(tx) && !reconcileInFlight.current.has(tx.id))
    if (activeRows.length === 0) return false

    setSyncing(true)
    try {
      await Promise.all(activeRows.map(async (tx) => {
        reconcileInFlight.current.add(tx.id)
        try {
          await api(`/mpesa/deposits/${tx.id}/reconcile`, { method: 'POST' })
        } finally {
          reconcileInFlight.current.delete(tx.id)
        }
      }))
      return true
    } finally {
      setSyncing(false)
    }
  }, [])

  const refreshAll = useCallback(async ({ reconcile = true } = {}) => {
    const rows = await refreshTransactions()
    let reconciled = false
    if (reconcile) {
      reconciled = await reconcileTransactions(rows)
    }
    await onRefresh()
    if (reconciled) await refreshTransactions()
    setLastSyncedAt(new Date())
  }, [onRefresh, reconcileTransactions, refreshTransactions])

  async function handleDepositCreated(transaction) {
    setTransactions((current) => [transaction, ...current.filter((item) => item.id !== transaction.id)])
    await refreshAll()
    setTab('home')
  }

  useEffect(() => {
    let cancelled = false

    async function loop() {
      if (cancelled) return
      try {
        await refreshAll()
      } catch (error) {
        console.error('Wallet reconciliation failed', error)
      }
    }

    loop()
    const timer = setInterval(loop, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [refreshAll])

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
        <div className={`connectionBadge ${syncing ? 'syncing' : ''}`}>
          <span />
          {syncing ? 'Updating' : 'Live'}
        </div>
      </header>

      <div className="desktopNav">
        {NAV_ITEMS.map((item) => (
          <button type="button" className={tab === item.id ? 'active' : ''} key={item.id} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
        <button type="button" className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>Activity</button>
      </div>

      <section className="phoneFrame">
        {tab === 'home' && <HomeScreen user={user} transactions={transactions} syncing={syncing} lastSyncedAt={lastSyncedAt} onRefresh={refreshAll} setTab={setTab} />}
        {tab === 'deposit' && <DepositFlow onCreated={handleDepositCreated} />}
        {tab === 'send' && <SendFlow onDone={refreshAll} />}
        {tab === 'withdraw' && <WithdrawFlow onDone={refreshAll} balanceBaseUnits={user.balanceBaseUnits} />}
        {tab === 'activity' && <ActivityScreen transactions={transactions} />}
        {tab === 'account' && <AccountScreen user={user} onSignOut={onSignOut} />}
      </section>

      <nav className="bottomNav" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => (
          <button type="button" className={tab === item.id ? 'active' : ''} key={item.id} onClick={() => setTab(item.id)}>
            <span>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
    </main>
  )
}

export default function MilestoneOneApp() {
  const [user, setUser] = useState(null)
  const [booting, setBooting] = useState(true)

  const refreshUser = useCallback(async () => {
    const result = await api('/me')
    setUser(result.user)
    return result.user
  }, [])

  function signOut() {
    localStorage.removeItem('dular_token')
    setUser(null)
  }

  useEffect(() => {
    async function boot() {
      if (!token()) {
        startTransition(() => setBooting(false))
        return
      }

      try {
        const result = await api('/me')
        startTransition(() => {
          setUser(result.user)
          setBooting(false)
        })
      } catch {
        localStorage.removeItem('dular_token')
        startTransition(() => setBooting(false))
      }
    }
    boot()
  }, [])

  if (booting) {
    return (
      <div className="bootScreen">
        <div className="brandMark">D</div>
        <p>Opening your wallet...</p>
      </div>
    )
  }

  if (!user) return <AuthGate onAuth={setUser} />

  return <WalletApp user={user} onRefresh={refreshUser} onSignOut={signOut} />
}
