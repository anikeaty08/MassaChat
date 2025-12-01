## MassaChat – Encrypted WhatsApp-style dApp on Massa

### Monorepo structure

- `contracts` – AssemblyScript Massa smart contract (`chat_contract.wasm`)
- `apps/web` – React + Vite + TypeScript frontend UI
- `services/pinata-proxy` – Node.js Express Pinata proxy (`/api/pin`)
- `services/indexer` – Optional Massa smart contract event indexer
- `scripts/deploy_sc.js` – Contract deployment helper using `@massalabs/massa-sc-deployer`

---

### Prerequisites

- Node.js 20.19+ (or >=22.12) – Vite 7 and the new Massa SDKs require the modern runtime
- Massa wallet / access to Massa testnet or buildnet
- Pinata account (API key + secret)

---

### 1. Install dependencies

From the repo root:

```bash
npm install
```

---

### 2. Build the smart contracts

From the repo root:

```bash
npm run build:contracts
```

This generates:

- `contracts/build/chat_contract.wasm`

---

### 3. Environment variables

Create a `.env` file in the repo root (or export in your shell):

```bash
MASSA_ACCOUNT_PUBLIC_KEY=your_massa_public_key
MASSA_ACCOUNT_PRIVATE_KEY=your_massa_private_key
MASSA_ACCOUNT_PASSWORD=your_massa_wallet_password
MASSA_PUBLIC_API_URL=https://buildnet.massa.net/api/v2
# Optional overrides (or pass as CLI flags --fee= ... etc):
# MASSA_CHAIN_ID=77658318744905
# MASSA_DEPLOY_FEE=10000000          # 0.01 MAS (default)
# MASSA_DEPLOY_MAX_GAS=2500000       # default, customize per deployment
# MASSA_DEPLOY_MAX_COINS=1000000000  # default, customize per deployment
# MASSA_DEPLOY_COINS=0
```

For the Pinata proxy (`services/pinata-proxy`):

```bash
PINATA_API_KEY=your_pinata_api_key
PINATA_SECRET=your_pinata_secret
PORT=4001
```

For the indexer (`services/indexer`):

```bash
CHAT_CONTRACT_ADDRESS=AS1nZktFQJ7119NnqKpj6U98Mg19teZJ69XjuCEhKnNoAW75Nd3r
MASSA_PUBLIC_API_URL=https://buildnet.massa.net/api/v2
# Optional tuning
# MASSA_THREAD_COUNT=32
# MASSA_PERIOD_WINDOW=20
```

Frontend `.env` in `apps/web`:

```bash
VITE_CHAT_CONTRACT_ADDRESS=AS1nZktFQJ7119NnqKpj6U98Mg19teZJ69XjuCEhKnNoAW75Nd3r
VITE_PINATA_PROXY_URL=http://localhost:4001
VITE_MASSA_PRIVATE_KEY=your_massa_private_key
```

> Never hardcode these secrets into source control for production deployments.

---

### 4. Deploy the contract to Massa testnet

Build the WASM first (see step 2), then from the repo root:

```bash
npm run deploy:sc -- contracts/build/chat_contract.wasm BUILDNET
```

Arguments:

- `contracts/build/chat_contract.wasm` – path to the compiled WASM (defaults to this file)
- `BUILDNET` – network shortcut (`BUILDNET`, `TESTNET`, `MAINNET`, etc.). The script maps this to the correct RPC URL, or you can override with `--publicApi=<url>`.

Optional flags (override env vars / defaults):

- `--publicApi=https://...` – custom RPC endpoint
- `--chainId=77658366` – skip automatic chain id discovery
- `--fee=...` – fee in nano MAS (`MASSA_DEPLOY_FEE`)
- `--maxGas=...` – ExecuteSC gas cap (`MASSA_DEPLOY_MAX_GAS`)
- `--maxCoins=...` – explicit spend cap (`MASSA_DEPLOY_MAX_COINS`); omit to auto-estimate
- `--coins=...` – MAS sent with the deployment (`MASSA_DEPLOY_COINS`)

The script auto-loads `.env`, resolves the node status (if needed), signs with your provided account, submits the deployment, waits for finality, then prints the operation id and emitted events (including the deployed address).

On Massa Buildnet, this repo is currently wired for the deployed chat contract:

- **Deployed contract address**: `AS1nZktFQJ7119NnqKpj6U98Mg19teZJ69XjuCEhKnNoAW75Nd3r`

Copy this (or your own deployed address) into:

- `CHAT_CONTRACT_ADDRESS` (indexer)
- `VITE_CHAT_CONTRACT_ADDRESS` (frontend)

---

### 5. Run the Pinata proxy backend

From the repo root:

```bash
npm run dev:pinata-proxy
```

The service exposes:

- `POST /api/pin` – JSON or file upload

Response:

```json
{ "cid": "bafy...", "ipfsUrl": "https://gateway.pinata.cloud/ipfs/bafy..." }
```

Docker build (optional):

```bash
cd services/pinata-proxy
docker build -t massa-chat-pinata-proxy .
docker run -p 4001:4001 --env-file .env massa-chat-pinata-proxy
```

---

### 6. Run the frontend dApp

From the repo root:

```bash
npm run dev:web
```

Then open the printed URL (default `http://localhost:5173`) in your browser.

Features:

- 3D-style landing page introducing features (on-chain messaging, E2E encryption, Massa dWeb)
- Connect Massa wallet via `@massalabs/wallet-provider`
- Per-user NaCl keypair for end-to-end encryption
- Chat box UI with encrypted messages stored as IPFS CIDs on Massa
- Fetch + decrypt messages from IPFS using your local secret key

---

### 7. Run the indexer (optional)

After setting `CHAT_CONTRACT_ADDRESS` in `services/indexer/.env`:

```bash
npm run dev:indexer
```

The indexer polls Massa smart contract events related to the chat contract and logs them; you can extend this to write to a database or expose a GraphQL/REST API.

---

### 8. Deploying to Massa dWeb

Once your contract is deployed and `apps/web` is configured with its address:

1. Build the frontend:

   ```bash
   cd apps/web
   npm run build
   ```

2. Serve the built files (`dist/`) using Massa dWeb deployment tooling, pointing to the same contract address and backend URL as configured above.

Consult the official Massa dWeb docs for the exact deployment CLI/steps for static sites.


