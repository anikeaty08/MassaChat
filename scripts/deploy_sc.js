#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

const DEFAULTS = {
  publicApi: 'https://buildnet.massa.net/api/v2',
  fee: '100000000', // 0.1 MAS
  maxGas: '3500000000',
  coins: '0',
};

const NETWORK_ENDPOINTS = {
  BUILDNET: 'https://buildnet.massa.net/api/v2',
  TESTNET: 'https://test.massa.net/api/v2',
  MAINNET: 'https://massa.net/api/v2',
  LABNET: 'https://labnet.massa.net/api/v2',
};

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }
  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const rawLine of lines) {
    if (!rawLine) {
      continue;
    }
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const [key, ...rest] = line.split('=');
    if (!key || rest.length === 0) {
      continue;
    }
    if (!process.env[key]) {
      process.env[key] = rest.join('=');
    }
  }
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};

  argv.forEach((arg) => {
    if (arg.startsWith('--')) {
      const [rawKey, rawValue] = arg.replace(/^--/, '').split('=');
      const key = rawKey.trim();
      const value = rawValue === undefined ? 'true' : rawValue.trim();
      flags[key] = value;
    } else {
      positional.push(arg);
    }
  });

  return { positional, flags };
}

function readBigInt(key, flags, envKey, fallback) {
  const raw =
    flags[key] ??
    process.env[envKey] ??
    fallback;
  return BigInt(raw);
}

function readOptionalBigInt(key, flags, envKey) {
  const raw =
    flags[key] ??
    process.env[envKey];
  return raw !== undefined ? BigInt(raw) : undefined;
}

async function resolveChainId(publicApi, explicitChainId) {
  if (explicitChainId) {
    return BigInt(explicitChainId);
  }
  if (process.env.MASSA_CHAIN_ID) {
    return BigInt(process.env.MASSA_CHAIN_ID);
  }

  const body = JSON.stringify({
    jsonrpc: '2.0',
    method: 'get_status',
    params: [],
    id: 0,
  });

  const response = await fetch(publicApi, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch chain id from ${publicApi}: ${response.statusText}`);
  }

  const data = await response.json();
  const chainIdStr = data?.result?.chain_id;
  if (!chainIdStr) {
    throw new Error('Unable to resolve chain id from node status response');
  }

  return BigInt(chainIdStr);
}

async function main() {
  loadDotEnv();

  const { Account, Args, JsonRpcProvider, OperationStatus } = await import('@massalabs/massa-web3');

  const { positional, flags } = parseArgs(process.argv.slice(2));
  const wasmPathArg = positional[0] || 'contracts/build/chat_contract.wasm';
  const networkArg = (positional[1] || process.env.MASSA_NETWORK || 'BUILDNET').toUpperCase();
  const wasmAbs = path.resolve(process.cwd(), wasmPathArg);

  const publicKey = process.env.MASSA_ACCOUNT_PUBLIC_KEY;
  const privateKey = process.env.MASSA_ACCOUNT_PRIVATE_KEY;
  const password = process.env.MASSA_ACCOUNT_PASSWORD;

  if (!publicKey || !privateKey || !password) {
    console.error('Missing MASSA_ACCOUNT_PUBLIC_KEY / MASSA_ACCOUNT_PRIVATE_KEY / MASSA_ACCOUNT_PASSWORD env vars');
    process.exit(1);
  }

  const publicApi =
    flags.publicApi ??
    process.env.MASSA_PUBLIC_API_URL ??
    NETWORK_ENDPOINTS[networkArg] ??
    DEFAULTS.publicApi;

  const wasmBytes = fs.readFileSync(wasmAbs);
  const account = await Account.fromPrivateKey(privateKey);
  const provider = JsonRpcProvider.fromRPCUrl(publicApi, account);

  const fee = readBigInt('fee', flags, 'MASSA_DEPLOY_FEE', DEFAULTS.fee);
  const maxGas = readBigInt('maxGas', flags, 'MASSA_DEPLOY_MAX_GAS', DEFAULTS.maxGas);
  const maxCoins = readOptionalBigInt('maxCoins', flags, 'MASSA_DEPLOY_MAX_COINS');
  const coins = readBigInt('coins', flags, 'MASSA_DEPLOY_COINS', DEFAULTS.coins);

  console.log(
    `Deploying ${wasmAbs} to ${publicApi} with fee=${fee} maxGas=${maxGas} maxCoins=${maxCoins ?? 'auto'} coins=${coins}`,
  );

  const args = new Args();
  const operation = await provider.deploy({
    byteCode: new Uint8Array(wasmBytes),
    parameter: args,
    fee,
    maxGas,
    coins,
    maxCoins,
  });

  const status = await operation.waitFinalExecution();
  if (status !== OperationStatus.Success) {
    throw new Error(`Deployment failed with status ${status}`);
  }

  const deployedAddress = await operation.getDeployedAddress(true);
  console.log('Deployment successful. Contract address:', deployedAddress);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
