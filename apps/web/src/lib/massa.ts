import { getWallets } from '@massalabs/wallet-provider';
import {
  Account,
  Args,
  JsonRpcProvider,
  OperationStatus,
  SmartContract,
} from '@massalabs/massa-web3';

const CONTRACT_ADDRESS = import.meta.env.VITE_CHAT_CONTRACT_ADDRESS ?? '';
const PRIVATE_KEY = import.meta.env.VITE_MASSA_PRIVATE_KEY ?? '';

type WalletAccount = {
  address: string;
};

type WalletProvider = {
  enabled(): boolean;
  connect(): Promise<unknown>;
  connected(): Promise<boolean>;
  accounts?: () => Promise<WalletAccount[]>;
  getAccounts?: () => Promise<WalletAccount[]>;
};

export type MassaConnection = {
  account: string;
};

let cachedAccount: WalletAccount | null = null;
let cachedWriteContract: SmartContract | null = null;
let cachedReadContract: SmartContract | null = null;

function ensureContractAddress(): asserts CONTRACT_ADDRESS is string {
  if (!CONTRACT_ADDRESS) {
    throw new Error('VITE_CHAT_CONTRACT_ADDRESS is not set');
  }
}

function getReadContract(): SmartContract {
  ensureContractAddress();
  if (!cachedReadContract) {
    const provider = JsonRpcProvider.buildnet();
    cachedReadContract = new SmartContract(provider, CONTRACT_ADDRESS);
  }
  return cachedReadContract;
}

async function getWriteContract(): Promise<SmartContract> {
  ensureContractAddress();
  if (!PRIVATE_KEY) {
    throw new Error('VITE_MASSA_PRIVATE_KEY is not set');
  }
  if (!cachedWriteContract) {
    const account = await Account.fromPrivateKey(PRIVATE_KEY);
    const provider = JsonRpcProvider.buildnet(account);
    cachedWriteContract = new SmartContract(provider, CONTRACT_ADDRESS);
  }
  return cachedWriteContract;
}

function resolveAccountsFetcher(wallet: WalletProvider) {
  if (typeof wallet.accounts === 'function') {
    return wallet.accounts.bind(wallet);
  }
  if (typeof wallet.getAccounts === 'function') {
    return wallet.getAccounts.bind(wallet);
  }
  return null;
}

export async function connectWallet(): Promise<MassaConnection> {
  if (!cachedAccount) {
    const wallets = (await getWallets(1000)) as WalletProvider[];
    const wallet = wallets.find((w) => w.enabled()) ?? wallets[0];
    if (!wallet) {
      throw new Error(
        'No Massa wallet provider detected. Make sure Massa Station or a compatible wallet extension is installed and unlocked.',
      );
    }

    if (!(await wallet.connected())) {
      await wallet.connect();
    }

    const fetchAccounts = resolveAccountsFetcher(wallet);
    if (!fetchAccounts) {
      throw new Error(
        'Connected wallet does not expose an accounts() or getAccounts() method. Please update your wallet extension.',
      );
    }

    const accounts = await fetchAccounts();
    const account = accounts?.[0];
    if (!account?.address) {
      throw new Error('No Massa account available in the connected wallet');
    }
    cachedAccount = account;
  }

  return { account: cachedAccount.address };
}

export async function addMessage(
  convId: string,
  cid: string,
): Promise<bigint> {
  const contract = await getWriteContract();
  const args = new Args().addString(convId).addString(cid);
  const operation = await contract.call('add_message', args, {
    fee: 0n,
    maxGas: 1_000_000n,
    coins: 0n,
  });

  const status = await operation.waitFinalExecution();
  if (status !== OperationStatus.Success) {
    throw new Error(`add_message failed with status ${OperationStatus[status] ?? status}`);
  }

  // For simplicity we return 0n; callers can refetch the latest index.
  return 0n;
}

export async function getLastIndex(convId: string): Promise<bigint> {
  const contract = getReadContract();
  const args = new Args().addString(convId);
  const res = await contract.read('get_last_index', args);
  if (!res.value?.length) {
    return 0n;
  }
  const decoded = new Args(res.value);
  return BigInt(decoded.nextU64());
}

export async function getMessage(convId: string, index: bigint): Promise<string> {
  const contract = getReadContract();
  const args = new Args().addString(convId).addU64(index);
  const res = await contract.read('get_message', args);
  if (!res.value?.length) {
    return '';
  }
  const decoded = new Args(res.value);
  return decoded.nextString();
}


