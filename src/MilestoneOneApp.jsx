import { useEffect, useState, startTransition } from 'react'
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

function formatRUsd(value) {
  const amount = BigInt(String(value || '0'))
  const whole = amount / RUSD_BASE
  const fraction = (amount % RUSD_BASE).toString().padStart(8, '0').replace(/0+$/, '')
  return `${whole}${fraction ? `.${fraction}` : ''} RUSD`
}

function toBaseUnits(value) {
  const raw = String(value || '').trim()
  if (!/^\d+(\.\d{1,8})?$/.test(raw)) throw new Error('Enter a valid RUSD amount')
  const [whole, fraction = ''] = raw.split('.')
  return (BigInt(whole) * RUSD_BASE + BigInt(fraction.padEnd(8, '0'))).toString()
}

function Status({ state }) {
  if (!state) return null
  return <div className={`statusMessage ${state.type}`}>{state.message}</div>
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
      setStatus({ type: 'success', message: 'Verification code sent.' })
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
    <div className="authShell">
      <div className="header compact">
        <h1>Dular</h1>
        <p>Verify your phone number to use RUSD with M-Pesa.</p>
      </div>
      <div className="glass-panel authPanel">
        {step === 'phone' ? (
          <form onSubmit={requestOtp}>
            <h2>Phone Identity</h2>
            <p className="muted">Use the M-Pesa phone number you will deposit from and withdraw to.</p>
            <div className="formGroup">
              <label>Phone number</label>
              <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+254712345678" required />
            </div>
            <button type="submit" disabled={loading}>{loading ? 'Sending...' : 'Send OTP'}</button>
          </form>
        ) : (
          <form onSubmit={verifyOtp}>
            <h2>Enter OTP</h2>
            <p className="muted">Code sent to {phone}. {demoCode ? `Demo code: ${demoCode}` : ''}</p>
            <div className="formGroup">
              <label>Verification code</label>
              <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="123456" required />
            </div>
            <div className="buttonRow">
              <button type="button" className="secondaryBtn" onClick={() => setStep('phone')}>Change phone</button>
              <button type="submit" disabled={loading}>{loading ? 'Verifying...' : 'Verify phone'}</button>
            </div>
          </form>
        )}
        <Status state={status} />
      </div>
    </div>
  )
}

function MoneyCard({ title, description, buttonText, onSubmit }) {
  const [amountKes, setAmountKes] = useState('')
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setLoading(true)
    setStatus(null)
    try {
      const message = await onSubmit(amountKes)
      setAmountKes('')
      setStatus({ type: 'success', message })
    } catch (error) {
      setStatus({ type: 'error', message: error.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="actionCard">
      <h3>{title}</h3>
      <p className="muted">{description}</p>
      <form onSubmit={submit}>
        <div className="formGroup">
          <label>Amount (KES)</label>
          <input type="number" min="1" value={amountKes} onChange={(event) => setAmountKes(event.target.value)} required />
        </div>
        <button type="submit" disabled={loading}>{loading ? 'Processing...' : buttonText}</button>
      </form>
      <Status state={status} />
    </div>
  )
}

function SendPhone({ onDone }) {
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
      setStatus({ type: 'success', message: `Sent payment ${result.paymentId}` })
      await onDone()
    } catch (error) {
      setStatus({ type: 'error', message: error.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="actionCard wide">
      <h3>Send To Phone</h3>
      <p className="muted">Transfer RUSD to another verified Dular phone number.</p>
      <form className="splitForm" onSubmit={submit}>
        <div className="formGroup">
          <label>Recipient phone</label>
          <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+254700000001" required />
        </div>
        <div className="formGroup">
          <label>Amount (RUSD)</label>
          <input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="1.00" required />
        </div>
        <button type="submit" disabled={loading}>{loading ? 'Sending...' : 'Send RUSD'}</button>
      </form>
      <Status state={status} />
    </div>
  )
}

function Transactions({ rows }) {
  return (
    <div className="glass-panel">
      <h2>M-Pesa Receipts</h2>
      <div className="channelList compactList">
        {rows.length === 0 ? <p className="muted">No deposits or withdrawals yet.</p> : rows.map((tx) => (
          <div className="channelItem" key={tx.id}>
            <div>
              <strong>{tx.kind} · {tx.status}</strong>
              <p className="channelMeta">KES {tx.kes_amount} · {formatRUsd(tx.rusd_base_units)}</p>
              {tx.receipt_number && <p className="channelMeta">Receipt: {tx.receipt_number}</p>}
            </div>
            <div className="channelMeta">{new Date(tx.created_at).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Wallet({ user, onRefresh }) {
  const [transactions, setTransactions] = useState([])

  async function refreshTransactions() {
    const result = await api('/transactions')
    setTransactions(result.transactions || [])
  }

  async function refreshAll() {
    await onRefresh()
    await refreshTransactions()
  }

  useEffect(() => {
    async function load() {
      try {
        const result = await api('/transactions')
        startTransition(() => {
          setTransactions(result.transactions || [])
        })
      } catch {
        startTransition(() => {
          setTransactions([])
        })
      }
    }
    load()
  }, [])

  return (
    <div className="contentArea">
      <div className="glass-panel heroPanel">
        <div>
          <span className="statLabel">Verified phone</span>
          <h2>{user.phone}</h2>
          <p className="muted">Fiber identity: {user.fiberPubkey || 'pending node connection'}</p>
        </div>
        <div className="balanceBlock">
          <span className="statLabel">Available balance</span>
          <strong>{formatRUsd(user.balanceBaseUnits)}</strong>
          <button type="button" className="secondaryBtn" onClick={refreshAll}>Refresh</button>
        </div>
      </div>

      <div className="actionGrid">
        <MoneyCard
          title="Deposit From M-Pesa"
          description="Trigger STK Push. RUSD credits after the Daraja callback confirms payment."
          buttonText="Request STK Push"
          onSubmit={async (amountKes) => {
            const result = await api('/mpesa/deposit', { method: 'POST', body: JSON.stringify({ amountKes }) })
            await refreshAll()
            return `Deposit pending: ${result.transaction.checkout_request_id}`
          }}
        />
        <MoneyCard
          title="Withdraw To M-Pesa"
          description="Debit your RUSD ledger and send KES to your verified phone through B2C."
          buttonText="Withdraw"
          onSubmit={async (amountKes) => {
            const result = await api('/mpesa/withdraw', { method: 'POST', body: JSON.stringify({ amountKes }) })
            await refreshAll()
            return `Withdrawal pending: ${result.transaction.id}`
          }}
        />
      </div>

      <SendPhone onDone={refreshAll} />
      <Transactions rows={transactions} />
    </div>
  )
}

function LookupTool() {
  const [phone, setPhone] = useState('')
  const [status, setStatus] = useState(null)
  const [result, setResult] = useState(null)

  async function submit(event) {
    event.preventDefault()
    setStatus(null)
    setResult(null)
    try {
      const data = await api(`/registry/lookup?phone=${encodeURIComponent(phone)}`)
      setResult(data)
    } catch (error) {
      setStatus({ type: 'error', message: error.message })
    }
  }

  return (
    <div className="contentArea">
      <div className="glass-panel">
        <h2>Registry Lookup</h2>
        <p className="muted">Reviewer-facing phone to Fiber identity endpoint.</p>
        <form onSubmit={submit} className="splitForm">
          <div className="formGroup">
            <label>Phone number</label>
            <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+254700000001" required />
          </div>
          <button type="submit">Lookup</button>
        </form>
        <Status state={status} />
        {result && (
          <div className="invoiceResult">
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  )
}

export default function MilestoneOneApp() {
  const [user, setUser] = useState(null)
  const [tab, setTab] = useState('wallet')
  const [booting, setBooting] = useState(true)

  async function refreshUser() {
    const result = await api('/me')
    setUser(result.user)
  }

  useEffect(() => {
    async function boot() {
      if (!token()) {
        startTransition(() => {
          setBooting(false)
        })
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
        startTransition(() => {
          setBooting(false)
        })
      }
    }
    boot()
  }, [])

  if (booting) return <p className="muted">Loading Dular...</p>
  if (!user) return <AuthGate onAuth={setUser} />

  return (
    <div className="appContainer">
      <div className="header">
        <h1>Dular</h1>
        <p>Phone-number stablecoin wallet for M-Pesa users</p>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'wallet' ? 'active' : ''}`} onClick={() => setTab('wallet')}>Wallet</button>
        <button className={`tab ${tab === 'lookup' ? 'active' : ''}`} onClick={() => setTab('lookup')}>Registry</button>
        <button
          className="tab"
          onClick={() => {
            localStorage.removeItem('dular_token')
            setUser(null)
          }}
        >
          Sign out
        </button>
      </div>

      {tab === 'wallet' && <Wallet user={user} onRefresh={refreshUser} />}
      {tab === 'lookup' && <LookupTool />}
    </div>
  )
}
