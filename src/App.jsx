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
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.result;
}

function Dashboard() {
  const [info, setInfo] = useState(null)
  const [channels, setChannels] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    rpcCall('node_info').then(setInfo).catch(e => setError(e.message))
    rpcCall('list_channels', [{}]).then(res => setChannels(res.channels || [])).catch(console.error)
  }, [])

  return (
    <div className="contentArea">
      <div className="glass-panel">
        <h2>Node Overview</h2>
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
          </div>
        ) : <p>Loading node info...</p>}
        
        <h3 style={{marginTop: '2rem'}}>Active Channels</h3>
        <div className="channelList">
          {channels.length === 0 ? <p style={{color: '#888'}}>No active channels found.</p> : channels.map(c => (
            <div className={`channelItem ${c.state_name !== 'ChannelReady' ? 'pending' : ''}`} key={c.channel_id}>
              <div>
                <strong>Peer: {c.peer_id.slice(0, 16)}...</strong>
                <p style={{margin: '0.2rem 0', fontSize: '0.9rem', color: '#888'}}>State: {c.state_name}</p>
              </div>
              <div style={{textAlign: 'right'}}>
                <div><strong>Local Balance:</strong> {parseInt(c.local_balance, 16).toLocaleString()}</div>
                <div style={{fontSize: '0.8rem', color: '#888'}}>Capacity: {parseInt(c.capacity, 16).toLocaleString()}</div>
              </div>
            </div>
          ))}
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
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(null)

  const handleSend = async (e) => {
    e.preventDefault()
    setLoading(true)
    setStatus(null)
    try {
      await rpcCall('send_payment', [{ invoice }])
      setStatus({ type: 'success', msg: 'Payment initiated successfully!' })
      setInvoice('')
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
        <form onSubmit={handleOpen}>
          <div className="formGroup">
            <label>Peer Pubkey</label>
            <input type="text" value={pubkey} onChange={e => setPubkey(e.target.value)} required placeholder="02..." />
          </div>
          <div className="formGroup">
            <label>Funding Amount (RUSD Base Units)</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} required placeholder="e.g. 50" />
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
