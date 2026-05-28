import { useState, useEffect } from 'react'
import './App.css'

const RUSD_SCRIPT = {
  code_hash: "0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a",
  hash_type: "type",
  args: "0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b"
}

async function rpcCall(method, params = []) {
  const res = await fetch('/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
  });
  if (!res.ok) {
    throw new Error(`RPC request failed: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  if (!text) {
    throw new Error('Empty response from node — is it running?');
  }
  const data = JSON.parse(text);
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.result;
}

function formatBaseUnits(value) {
  if (!value) return '0'
  const asNumber = typeof value === 'string' && value.startsWith('0x')
    ? parseInt(value, 16)
    : Number(value)
  return Number.isFinite(asNumber) ? asNumber.toLocaleString() : String(value)
}

function formatHexCount(value) {
  if (!value) return 0
  return typeof value === 'string' && value.startsWith('0x')
    ? parseInt(value, 16)
    : Number(value)
}

function shortenHash(value = '', head = 14) {
  if (!value) return ''
  if (value.length <= head * 2) return value
  return `${value.slice(0, head)}...${value.slice(-head)}`
}

function RouteView({ routers = [] }) {
  if (!routers.length) {
    return <p className="channelMeta">No recorded route yet.</p>
  }

  return (
    <div className="routeList">
      {routers.map((route, index) => (
        <div key={`${route.length}-${index}`} className="routeCard">
          <strong>Route {index + 1}</strong>
          <div className="routeChain">
            {route.map((hop, hopIndex) => {
              const amount = hop.amount ? formatBaseUnits(hop.amount) : 'n/a'
              const pubkey = hop.pubkey || hop.node || ''
              const channel = hop.channel_outpoint || hop.channel || ''
              return (
                <div key={`${pubkey}-${hopIndex}`} className="routeHop">
                  <div>{shortenHash(pubkey, 10)}</div>
                  <div className="channelMeta">Amount: {amount}</div>
                  {channel && <div className="channelMeta">Channel: {shortenHash(channel, 10)}</div>}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function Dashboard() {
  const [info, setInfo] = useState(null)
  const [channels, setChannels] = useState([])
  const [pendingChannels, setPendingChannels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadDashboard = async () => {
    setLoading(true)
    setError('')
    try {
      const [nodeInfo, readyResult, pendingResult] = await Promise.all([
        rpcCall('node_info'),
        rpcCall('list_channels', [{}]),
        rpcCall('list_channels', [{ only_pending: true }]),
      ])
      setInfo(nodeInfo)
      setChannels(readyResult.channels || [])
      setPendingChannels(pendingResult.channels || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDashboard()
  }, [])

  return (
    <div className="contentArea">
      <div className="glass-panel">
        <div className="panelHeader">
          <h2>Node Overview</h2>
          <button type="button" className="secondaryBtn" onClick={loadDashboard} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        {error && <div className="statusMessage error">{error}</div>}
        {info ? (
          <div className="statsGrid">
            <div className="statCard">
              <span className="statLabel">Pubkey</span>
              <span className="statValue" style={{fontSize: '0.8rem'}}>{info.pubkey}</span>
            </div>
            <div className="statCard">
              <span className="statLabel">Version</span>
              <span className="statValue">{info.version}</span>
            </div>
            <div className="statCard">
              <span className="statLabel">Peers Connected</span>
              <span className="statValue">{parseInt(info.peers_count || '0', 16)}</span>
            </div>
            <div className="statCard">
              <span className="statLabel">Ready Channels</span>
              <span className="statValue">{parseInt(info.channel_count || '0', 16)}</span>
            </div>
            <div className="statCard">
              <span className="statLabel">Pending Channels</span>
              <span className="statValue">{parseInt(info.pending_channel_count || '0', 16)}</span>
            </div>
          </div>
        ) : <p>Loading node info...</p>}

        <h3 style={{marginTop: '2rem'}}>Pending Channel Opens</h3>
        <div className="channelList">
          {pendingChannels.length === 0 ? <p style={{color: '#888'}}>No pending channel opens.</p> : pendingChannels.map(c => {
            const stateName = c.state?.state_name || c.state_name || 'Unknown';
            const peerId = c.pubkey || c.peer_id || '';
            const localBal = formatBaseUnits(c.local_balance);
            const failureDetail = c.failure_detail || '';
            return (
            <div className="channelItem pending" key={c.channel_id}>
              <div>
                <strong>Peer: {peerId.slice(0, 16)}...</strong>
                <p style={{margin: '0.2rem 0', fontSize: '0.9rem', color: '#888'}}>State: {stateName}</p>
                {failureDetail && <p className="channelMeta">Failure: {failureDetail}</p>}
              </div>
              <div style={{textAlign: 'right'}}>
                <div><strong>Requested Funding:</strong> {localBal}</div>
                <div className="channelMeta">Base units</div>
              </div>
            </div>
            );
          })}
        </div>

        <h3 style={{marginTop: '2rem'}}>Active Channels</h3>
        <div className="channelList">
          {channels.length === 0 ? <p style={{color: '#888'}}>No active channels found.</p> : channels.map(c => {
            const stateName = c.state?.state_name || c.state_name || 'Unknown';
            const peerId = c.pubkey || c.peer_id || '';
            const localBal = formatBaseUnits(c.local_balance);
            const remoteBal = formatBaseUnits(c.remote_balance);
            return (
            <div className={`channelItem ${stateName !== 'ChannelReady' ? 'pending' : ''}`} key={c.channel_id}>
              <div>
                <strong>Peer: {peerId.slice(0, 16)}...</strong>
                <p style={{margin: '0.2rem 0', fontSize: '0.9rem', color: '#888'}}>State: {stateName}</p>
              </div>
              <div style={{textAlign: 'right'}}>
                <div><strong>Local Balance:</strong> {localBal.toLocaleString()}</div>
                <div style={{fontSize: '0.8rem', color: '#888'}}>Remote: {remoteBal.toLocaleString()}</div>
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </div>
  )
}

function Receive() {
  const [amount, setAmount] = useState('')
  const [desc, setDesc] = useState('')
  const [invoice, setInvoice] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleGenerate = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setInvoice('')
    try {
      // Amount in hex for RPC
      const hexAmount = '0x' + parseInt(amount).toString(16)
      const res = await rpcCall('new_invoice', [{
        amount: hexAmount,
        currency: 'Fibt',
        description: desc,
        expiry: '0xe10', // 1 hour
        udt_type_script: RUSD_SCRIPT
      }])
      setInvoice(res.invoice_address)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  return (
    <div className="contentArea">
      <div className="glass-panel">
        <h2>Receive RUSD</h2>
        <p style={{color: '#888', marginBottom: '1.5rem'}}>Generate a stablecoin invoice to receive payments natively.</p>
        <form onSubmit={handleGenerate}>
          <div className="formGroup">
            <label>Amount (RUSD Base Units)</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} required placeholder="e.g. 10" />
          </div>
          <div className="formGroup">
            <label>Description</label>
            <input type="text" value={desc} onChange={e => setDesc(e.target.value)} required placeholder="Payment for services..." />
          </div>
          <button type="submit" disabled={loading}>{loading ? 'Generating...' : 'Create Invoice'}</button>
        </form>

        {error && <div className="statusMessage error">{error}</div>}
        
        {invoice && (
          <div className="invoiceResult">
            <button className="copyBtn" onClick={() => navigator.clipboard.writeText(invoice)}>Copy</button>
            <div style={{wordBreak: 'break-all', paddingRight: '3rem'}}>{invoice}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function Send() {
  const [invoice, setInvoice] = useState('')
  const [latestPayment, setLatestPayment] = useState(null)
  const [recentPayments, setRecentPayments] = useState([])
  const [loading, setLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [status, setStatus] = useState(null)

  const loadPayments = async () => {
    setHistoryLoading(true)
    try {
      const res = await rpcCall('list_payments', [{ limit: '0xa' }])
      setRecentPayments(res.payments || [])
    } catch (err) {
      setStatus({ type: 'error', msg: err.message })
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    loadPayments()
  }, [])

  const handleSend = async (e) => {
    e.preventDefault()
    setLoading(true)
    setStatus(null)
    try {
      const res = await rpcCall('send_payment', [{ invoice }])
      setLatestPayment(res)
      setStatus({ type: 'success', msg: `Payment initiated: ${res.payment_hash}` })
      setInvoice('')
      await loadPayments()
    } catch (err) {
      setStatus({ type: 'error', msg: err.message })
    }
    setLoading(false)
  }

  return (
    <div className="contentArea">
      <div className="glass-panel">
        <h2>Send Payment</h2>
        <p style={{color: '#888', marginBottom: '1.5rem'}}>Pay any FNN stablecoin invoice instantly.</p>
        <form onSubmit={handleSend}>
          <div className="formGroup">
            <label>Invoice Address</label>
            <input type="text" value={invoice} onChange={e => setInvoice(e.target.value)} required placeholder="fibt1..." />
          </div>
          <button type="submit" disabled={loading}>{loading ? 'Sending...' : 'Pay Invoice'}</button>
        </form>

        {status && <div className={`statusMessage ${status.type}`}>{status.msg}</div>}

        {latestPayment && (
          <div className="paymentProofCard">
            <div className="panelHeader">
              <h3>Latest Payment Proof</h3>
              <button type="button" className="secondaryBtn" onClick={loadPayments} disabled={historyLoading}>
                {historyLoading ? 'Refreshing...' : 'Refresh Payments'}
              </button>
            </div>
            <div className="proofGrid">
              <div>
                <span className="statLabel">Payment Hash</span>
                <div className="proofValue">{latestPayment.payment_hash}</div>
              </div>
              <div>
                <span className="statLabel">Status</span>
                <div className="proofValue">{latestPayment.status}</div>
              </div>
              <div>
                <span className="statLabel">Fee Paid</span>
                <div className="proofValue">{formatBaseUnits(latestPayment.fee)}</div>
              </div>
              <div>
                <span className="statLabel">Route Count</span>
                <div className="proofValue">{latestPayment.routers?.length || 0}</div>
              </div>
            </div>
            <RouteView routers={latestPayment.routers || []} />
          </div>
        )}

        <div className="paymentProofCard">
          <div className="panelHeader">
            <h3>Recent Payments</h3>
            <button type="button" className="secondaryBtn" onClick={loadPayments} disabled={historyLoading}>
              {historyLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          {recentPayments.length === 0 ? (
            <p style={{color: '#888'}}>No payments recorded yet.</p>
          ) : (
            <div className="paymentList">
              {recentPayments.map(payment => (
                <div className="paymentItem" key={payment.payment_hash}>
                  <div>
                    <strong>{shortenHash(payment.payment_hash, 12)}</strong>
                    <p className="channelMeta">Status: {payment.status}</p>
                    <p className="channelMeta">Fee: {formatBaseUnits(payment.fee)}</p>
                  </div>
                  <div style={{textAlign: 'right'}}>
                    <div><strong>Routes:</strong> {payment.routers?.length || 0}</div>
                    <div className="channelMeta">Updated: {formatHexCount(payment.last_updated_at)}</div>
                  </div>
                  <RouteView routers={payment.routers || []} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function OpenChannel() {
  const [pubkey, setPubkey] = useState('')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(null)

  const handleOpen = async (e) => {
    e.preventDefault()
    setLoading(true)
    setStatus(null)
    try {
      const hexAmount = '0x' + parseInt(amount).toString(16)
      const res = await rpcCall('open_channel', [{
        pubkey,
        funding_amount: hexAmount,
        public: true,
        funding_udt_type_script: RUSD_SCRIPT
      }])
      setStatus({ type: 'success', msg: `Channel opening initiated! ID: ${res.temporary_channel_id}` })
      setPubkey('')
      setAmount('')
    } catch (err) {
      setStatus({ type: 'error', msg: err.message })
    }
    setLoading(false)
  }

  return (
    <div className="contentArea" style={{marginTop: '2rem'}}>
      <div className="glass-panel">
        <h2>Open RUSD Channel</h2>
        <p style={{color: '#888', marginBottom: '1.5rem'}}>Fund a new payment channel with a peer.</p>
        <div className="statusMessage warning">
          RUSD amounts here are base units. Enter `2000000000` to request 20 RUSD.
        </div>
        <form onSubmit={handleOpen}>
          <div className="formGroup">
            <label>Peer Pubkey</label>
            <input type="text" value={pubkey} onChange={e => setPubkey(e.target.value)} required placeholder="02..." />
          </div>
          <div className="formGroup">
            <label>Funding Amount (RUSD Base Units)</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} required placeholder="e.g. 2000000000" />
            <p className="inputHint">Peer auto-accept minimum for this test peer is `2000000000` base units.</p>
          </div>
          <button type="submit" disabled={loading}>{loading ? 'Opening...' : 'Open Channel'}</button>
        </form>

        {status && <div className={`statusMessage ${status.type}`}>{status.msg}</div>}
      </div>
    </div>
  )
}

function App() {
  const [tab, setTab] = useState('dashboard')

  return (
    <div className="appContainer">
      <div className="header">
        <h1>Dular</h1>
        <p>Next-Gen Stablecoin Settlements on CKB</p>
      </div>
      
      <div className="tabs">
        <button className={`tab ${tab === 'dashboard' ? 'active' : ''}`} onClick={() => setTab('dashboard')}>Dashboard</button>
        <button className={`tab ${tab === 'receive' ? 'active' : ''}`} onClick={() => setTab('receive')}>Receive</button>
        <button className={`tab ${tab === 'send' ? 'active' : ''}`} onClick={() => setTab('send')}>Send</button>
      </div>

      {tab === 'dashboard' && (
        <>
          <Dashboard />
          <OpenChannel />
        </>
      )}
      {tab === 'receive' && <Receive />}
      {tab === 'send' && <Send />}
    </div>
  )
}

export default App
