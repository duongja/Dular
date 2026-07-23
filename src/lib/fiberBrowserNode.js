const TESTNET_CONFIG = `
fiber:
  listening_addr: "/ip4/127.0.0.1/tcp/8228"
  bootnode_addrs:
    - "/dns4/thrall.fiber.channel/tcp/443/wss/p2p/Qmes1EBD4yNo9Ywkfe6eRw9tG1nVNGLDmMud1xJMsoYFKy"
    - "/dns4/onyxia.fiber.channel/tcp/443/wss/p2p/QmdyQWjPtbK4NWWsvy8s69NGJaQULwgeQDT5ZpNDrTNaeV"
  announce_listening_addr: false
  chain: testnet
  scripts:
    - name: FundingLock
      script:
        code_hash: 0x6c67887fe201ee0c7853f1682c0b77c0e6214044c156c7558269390a8afa6d7c
        hash_type: type
        args: 0x
      cell_deps:
        - type_id:
            code_hash: 0x00000000000000000000000000000000000000000000000000545950455f4944
            hash_type: type
            args: 0x3cb7c0304fe53f75bb5727e2484d0beae4bd99d979813c6fc97c3cca569f10f6
        - cell_dep:
            out_point:
              tx_hash: 0x12c569a258dd9c5bd99f632bb8314b1263b90921ba31496467580d6b79dd14a7
              index: 0x0
            dep_type: code
    - name: CommitmentLock
      script:
        code_hash: 0x740dee83f87c6f309824d8fd3fbdd3c8380ee6fc9acc90b1a748438afcdf81d8
        hash_type: type
        args: 0x
      cell_deps:
        - type_id:
            code_hash: 0x00000000000000000000000000000000000000000000000000545950455f4944
            hash_type: type
            args: 0xf7e458887495cf70dd30d1543cad47dc1dfe9d874177bf19291e4db478d5751b
        - cell_dep:
            out_point:
              tx_hash: 0x12c569a258dd9c5bd99f632bb8314b1263b90921ba31496467580d6b79dd14a7
              index: 0x0
            dep_type: code
rpc:
  listening_addr: "127.0.0.1:8227"
ckb:
  rpc_url: "https://testnet.ckb.dev/"
  udt_whitelist:
    - name: RUSD
      script:
        code_hash: 0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a
        hash_type: type
        args: 0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b
      cell_deps:
        - type_id:
            code_hash: 0x00000000000000000000000000000000000000000000000000545950455f4944
            hash_type: type
            args: 0x97d30b723c0b2c66e9cb8d4d0df4ab5d7222cbb00d4a9a2055ce2e5d7f0d8b0f
      auto_accept_amount: 1000000000
services:
  - fiber
  - rpc
  - ckb
`

export const RUSD_TYPE_SCRIPT = {
  code_hash: '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a',
  hash_type: 'type',
  args: '0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b',
}

let fiberLibPromise = null
let fiberInstance = null
let fiberDatabasePrefix = null

async function loadFiberLib() {
  if (!fiberLibPromise) {
    fiberLibPromise = import('@nervosnetwork/fiber-js')
  }
  return fiberLibPromise
}

export function canUseBrowserFiber() {
  return typeof window !== 'undefined'
    && window.isSecureContext
    && window.crossOriginIsolated
    && typeof SharedArrayBuffer !== 'undefined'
}

export async function startBrowserFiber({ fiberSecretKey, ckbSecretKey, databasePrefix }) {
  if (!canUseBrowserFiber()) {
    throw new Error('Browser Fiber requires a secure, cross-origin isolated page with SharedArrayBuffer support.')
  }

  if (fiberInstance) {
    if (fiberDatabasePrefix !== databasePrefix) {
      throw new Error('A different browser wallet is already running. Lock it before opening this wallet.')
    }
    return fiberInstance
  }

  const { Fiber } = await loadFiberLib()
  const fiber = new Fiber()
  await fiber.start(TESTNET_CONFIG, fiberSecretKey, ckbSecretKey, undefined, 'info', databasePrefix)
  fiberInstance = fiber
  fiberDatabasePrefix = databasePrefix
  return fiber
}

export function getBrowserFiber() {
  if (!fiberInstance) throw new Error('Browser Fiber node is not running')
  return fiberInstance
}

export async function stopBrowserFiber() {
  if (!fiberInstance) return
  try {
    await fiberInstance.stop()
  } finally {
    fiberInstance = null
    fiberDatabasePrefix = null
  }
}

export async function browserNodeInfo() {
  return getBrowserFiber().nodeInfo()
}

export async function browserListPeers() {
  return getBrowserFiber().listPeers()
}

export async function browserListChannels(options = {}) {
  return getBrowserFiber().listChannels(options)
}

export async function browserListPendingChannels() {
  return browserListChannels({ only_pending: true })
}

export async function browserAcceptChannel({ temporaryChannelId, fundingAmountHex = '0x0' }) {
  return getBrowserFiber().acceptChannel({
    temporary_channel_id: temporaryChannelId,
    funding_amount: fundingAmountHex,
  })
}

export async function browserOpenRUsdChannel({ pubkey, amountHex, isPublic = true }) {
  return getBrowserFiber().openChannel({
    pubkey,
    funding_amount: amountHex,
    public: isPublic,
    funding_udt_type_script: RUSD_TYPE_SCRIPT,
    tlc_fee_proportional_millionths: '0x0',
  })
}

export async function browserAbandonChannel(channelId) {
  return getBrowserFiber().abandonChannel({ channel_id: channelId })
}

export async function browserUpdateChannel({ channelId, tlcFeeProportionalMillionths = '0x0' }) {
  return getBrowserFiber().updateChannel({
    channel_id: channelId,
    tlc_fee_proportional_millionths: tlcFeeProportionalMillionths,
  })
}

export async function browserConnectPeer({ address, pubkey, addrType = 'ws' }) {
  return getBrowserFiber().connectPeer({
    ...(address ? { address } : {}),
    ...(pubkey ? { pubkey } : {}),
    ...(address || pubkey ? { addr_type: addrType } : {}),
  })
}

export async function browserCreateInvoice({ amountHex, description, expiry = '0xe10' }) {
  return getBrowserFiber().newInvoice({
    amount: amountHex,
    currency: 'Fibt',
    description,
    expiry,
    allow_trampoline_routing: true,
    udt_type_script: RUSD_TYPE_SCRIPT,
  })
}

export async function browserGetInvoice(paymentHash) {
  return getBrowserFiber().getInvoice({ payment_hash: paymentHash })
}

export async function browserSendPayment(invoice, { hopHints = [] } = {}) {
  return getBrowserFiber().sendPayment({
    invoice,
    ...(hopHints.length ? { hop_hints: hopHints } : {}),
  })
}

export async function browserSendKeysend({ targetPubkey, amountHex, hopHints = [], dryRun = false }) {
  return getBrowserFiber().sendPayment({
    target_pubkey: targetPubkey,
    amount: amountHex,
    keysend: true,
    udt_type_script: RUSD_TYPE_SCRIPT,
    ...(hopHints.length ? { hop_hints: hopHints } : {}),
    ...(dryRun ? { dry_run: true } : {}),
  })
}

export async function browserBuildRouter({ amountHex, hopsInfo, finalTlcExpiryDelta }) {
  return getBrowserFiber().buildRouter({
    amount: amountHex,
    udt_type_script: RUSD_TYPE_SCRIPT,
    hops_info: hopsInfo,
    ...(finalTlcExpiryDelta ? { final_tlc_expiry_delta: finalTlcExpiryDelta } : {}),
  })
}

export async function browserSendPaymentWithRouter(invoice, router) {
  return getBrowserFiber().sendPaymentWithRouter({
    invoice,
    router,
    udt_type_script: RUSD_TYPE_SCRIPT,
  })
}

export async function browserGetPayment(paymentHash) {
  return getBrowserFiber().getPayment({ payment_hash: paymentHash })
}
