# Dular Fiber Operator on Railway

This service runs the native Fiber node (`fnn`) plus a small gateway for Dular:

- `POST /rpc` proxies token-authenticated JSON-RPC to the local `fnn` RPC listener.
- WSS upgrades bridge browser Fiber nodes to the local native TCP listener.
- `GET /health` reports whether the gateway is online and whether `fnn` is responding.

The service is intended for the Dular browser self-custody flow. It gives browser wallets a reachable operator peer and gives the Vercel API a hosted Fiber RPC endpoint.

## Railway Service

Create a new Railway service from this GitHub repo.

Use these service settings:

```text
Root Directory: .
Dockerfile Path: railway/fiber/Dockerfile
Volume Mount Path: /data
```

Set these Railway variables:

```env
FIBER_SECRET_KEY_PASSWORD=<strong-password>
FIBER_NETWORK=testnet
FIBER_HOME=/data
RUST_LOG=info
FIBER_GATEWAY_RPC_TOKEN=<long-random-token>
CKB_RPC_URL=https://testnet.ckb.dev/
```

The mounted `/data` volume is required. It stores the operator key, CKB key, peer store, channels, graph data, and payment state. Do not delete it after opening channels.

After deploy, open:

```text
https://<railway-domain>/health
```

Expected response:

```json
{
  "ok": true,
  "gateway": "online",
  "fiber": "online",
  "pubkey": "02..."
}
```

If `fiber` is `starting`, check Railway logs. First boot can take longer while the node initializes.

## Vercel Variables

After Railway gives the service a public domain, update the Dular Vercel app:

```env
FIBER_RPC_URL=https://<railway-domain>/rpc
FIBER_GATEWAY_RPC_TOKEN=<same-long-random-token>
FIBER_OPERATOR_WS_ADDR=/dns4/<railway-domain>/tcp/443/wss
```

Then redeploy Vercel.

The browser wallet will call `/api/fiber/operator`, receive the Railway operator pubkey plus WSS multiaddr, and connect its browser Fiber node to Railway.

## Funding

The Railway operator must hold testnet CKB and RUSD UDT liquidity before it can open/fund browser channels.

Get the operator pubkey from:

```bash
curl https://<railway-domain>/health
```

Get full node info:

```bash
curl -s https://<railway-domain>/rpc \
  -H 'authorization: Bearer <long-random-token>' \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"node_info","params":[]}'
```

Use the returned `default_funding_lock_script.args` to derive/fund the operator CKB address with your existing local tooling, or fund it through the normal Fiber node wallet flow if you are operating the node directly.

## Notes

- Railway exposes the browser-facing side through HTTPS/WSS on the generated domain.
- Raw Fiber RPC is disabled when `FIBER_GATEWAY_RPC_TOKEN` is missing and rejects requests without the matching bearer token. Do not expose this token to the browser.
- Native Fiber TCP inbound from the public internet is not required for the Dular browser-wallet pilot because browser wallets dial the Railway gateway over WSS.
- Keep Fiber, `fiber-js`, and the public nodes on the same release line. This Dockerfile pins Fiber to `v0.9.0-rc7`, matching `@nervosnetwork/fiber-js`.
