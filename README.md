# Dular — Advanced Stablecoin Payments UI

Dular is a high-performance web interface built as a layer exactly on top of the **[Fiber Network Node (FNN)](https://github.com/nervosnetwork/fiber)**. 

Leveraging Next-Gen L2 scaling principles for the CKB blockchain, Dular facilitates instant Point Time-Locked Contract (PTLC) micropayments bound specifically to Stablecoin Universal Data Types (UDTs)—specifically supporting testnet `RUSD` out of the box.

## Architectural Overview

Direct JSON-RPC calls from modern browsers generally trigger Cross-Origin Resource Sharing (CORS) security exceptions. To maintain an elegantly decoupled frontend without exposing your native FNN node to arbitrary origins globally, Dular relies on a secure **Proxy Dev-Server Pattern** via Vite. The frontend application invokes `/rpc`, which seamlessly hands off to the Node running strictly on localhost loopbacks.

## Prerequisites

1. **A Functioning FNN Local Node**  
   You must have an FNN instance synchronized with Testnet and running its HTTP JSON-RPC endpoint. By default, Fiber opens this at `http://127.0.0.1:8227`.
   
   If you aren't running an FNN node yet, you can configure it via:
   ```bash
   # Make sure you have the FNN binaries and a configured testnet wallet
   FIBER_SECRET_KEY_PASSWORD='your_password' RUST_LOG=info ./fnn -c config.yml -d .
   ```
2. **Node.js** (v18.0+)

## Quick Start
1. **Clone the UI Repository**
   ```bash
   git clone https://github.com/duongja/Dular.git
   cd Dular
   ```

2. **Install Fast Dependencies**
   ```bash
   npm install
   ```

3. **Deploy the Development Server**
   ```bash
   npm run dev
   ```
   *Vite will automatically spin up and intercept all application JSON-RPC traffic on `/rpc`, forwarding it strictly to `127.0.0.1:8227` under the hood.*

## Interfacing with Stablecoins

Dular abstracts away raw hex serialization by formatting UDT constraints directly:
- **Node Dashboard**: Maps active CKB channel capabilities, `state_names`, and resolves active peers dynamically.
- **Invoicing (`new_invoice`)**: Configures `amount`, `currency: Fibt`, and auto-populates the required `RUSD` script hashes to create zero-cost settlement channels.
- **PTLC Payments (`send_payment`)**: Accepts FNN invoice payloads natively and commits off-chain transfers routing successfully through your peers.

## Configurations

If your FNN is running on a different port or bound externally, explicitly configure the Vite proxy map located in `vite.config.js`:

```javascript
// vite.config.js
server: {
  proxy: {
    '/rpc': {
      target: 'http://127.0.0.1:8227', // Target your instance here
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/rpc/, ''),
    },
  },
}
```

---
*Built tightly onto CKB Fiber infrastructures for uncompromised non-custodial UX execution.*
