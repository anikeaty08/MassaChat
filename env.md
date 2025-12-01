## Environment configuration

Copy the snippets below into a local `.env` (or into service-specific `.env` files).  
Do **not** commit your real keys; keep them private.

### Root `.env` (deployment / scripts)

```bash
MASSA_ACCOUNT_PUBLIC_KEY=your_massa_public_key
MASSA_ACCOUNT_PRIVATE_KEY=your_massa_private_key
MASSA_ACCOUNT_PASSWORD=your_massa_wallet_password
MASSA_PUBLIC_API_URL=https://buildnet.massa.net/api/v2

# Optional deployment tuning
# MASSA_CHAIN_ID=77658366
# MASSA_DEPLOY_FEE=100000000        # 0.1 MAS
# MASSA_DEPLOY_MAX_GAS=3500000000   # gas cap for ExecuteSC
# MASSA_DEPLOY_MAX_COINS=1000000000 # optional explicit max spend
# MASSA_DEPLOY_COINS=0
```

### `services/indexer/.env`

```bash
CHAT_CONTRACT_ADDRESS=AS1nZktFQJ7119NnqKpj6U98Mg19teZJ69XjuCEhKnNoAW75Nd3r
MASSA_PUBLIC_API_URL=https://buildnet.massa.net/api/v2
# Optional tuning
# MASSA_THREAD_COUNT=32
# MASSA_PERIOD_WINDOW=20
```

### `services/pinata-proxy/.env`

```bash
PINATA_API_KEY=e9eb9b1785da59b079ba
PINATA_SECRET=bf92eeb1cbaf1e3d5dac6fc608b7596e6a54fad9db7ef9e264ee3756fe41ddc1
PORT=4001
```

### `apps/web/.env`

```bash
VITE_CHAT_CONTRACT_ADDRESS=AS1nZktFQJ7119NnqKpj6U98Mg19teZJ69XjuCEhKnNoAW75Nd3r
VITE_PINATA_PROXY_URL=http://localhost:4001
VITE_MASSA_PRIVATE_KEY=your_massa_private_key
```


