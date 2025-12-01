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

// -------- Profiles / usernames / privacy / blocking / last-seen --------

export type OnChainProfile = {
  address: string;
  username: string;
  displayName: string;
  avatarCid: string;
  bio: string;
  createdAt: bigint;
  updatedAt: bigint;
};

export type OnChainPrivacy = {
  showLastSeen: boolean;
  showProfilePhoto: boolean;
  showBio: boolean;
};

function parseBigIntField(obj: any, key: string): bigint {
  const raw = (obj && (obj as any)[key]) ?? 0;
  if (typeof raw === 'bigint') return raw;
  if (typeof raw === 'number') return BigInt(raw);
  if (typeof raw === 'string' && raw.length > 0) return BigInt(raw);
  return 0n;
}

export async function registerProfile(args: {
  ownerAddress: string;
  username: string;
  displayName: string;
  avatarCid: string;
  bio: string;
}): Promise<void> {
  const contract = await getWriteContract();
  const callArgs = new Args()
    .addString(args.ownerAddress)
    .addString(args.username)
    .addString(args.displayName)
    .addString(args.avatarCid)
    .addString(args.bio);

  const op = await contract.call('register_profile', callArgs, {
    fee: 0n,
    maxGas: 900_000n,
    coins: 0n,
  });
  const status = await op.waitFinalExecution();
  if (status !== OperationStatus.Success) {
    throw new Error(`register_profile failed with status ${OperationStatus[status] ?? status}`);
  }
}

function decodeProfileJson(json: string | null | undefined): OnChainProfile | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json as string);
    return {
      address: raw.address ?? '',
      username: raw.username ?? '',
      displayName: raw.displayName ?? '',
      avatarCid: raw.avatarCid ?? '',
      bio: raw.bio ?? '',
      createdAt: parseBigIntField(raw, 'createdAt'),
      updatedAt: parseBigIntField(raw, 'updatedAt'),
    };
  } catch {
    return null;
  }
}

export async function getProfileByAddress(address: string): Promise<OnChainProfile | null> {
  const contract = getReadContract();
  const args = new Args().addString(address);
  const res = await contract.read('get_profile_by_address', args);
  if (!res.value?.length) return null;
  const decoded = new Args(res.value);
  const json = decoded.nextString();
  return decodeProfileJson(json);
}

export async function getProfileByUsername(username: string): Promise<OnChainProfile | null> {
  const contract = getReadContract();
  const args = new Args().addString(username);
  const res = await contract.read('get_profile_by_username', args);
  if (!res.value?.length) return null;
  const decoded = new Args(res.value);
  const json = decoded.nextString();
  return decodeProfileJson(json);
}

export async function setPrivacy(opts: {
  ownerAddress: string;
  showLastSeen: boolean;
  showProfilePhoto: boolean;
  showBio: boolean;
}): Promise<void> {
  const contract = await getWriteContract();
  const args = new Args()
    .addString(opts.ownerAddress)
    .addBool(opts.showLastSeen)
    .addBool(opts.showProfilePhoto)
    .addBool(opts.showBio);
  const op = await contract.call('set_privacy', args, {
    fee: 0n,
    maxGas: 400_000n,
    coins: 0n,
  });
  const status = await op.waitFinalExecution();
  if (status !== OperationStatus.Success) {
    throw new Error(`set_privacy failed with status ${OperationStatus[status] ?? status}`);
  }
}

export async function getPrivacy(address: string): Promise<OnChainPrivacy | null> {
  const contract = getReadContract();
  const args = new Args().addString(address);
  const res = await contract.read('get_privacy', args);
  if (!res.value?.length) return null;
  const decoded = new Args(res.value);
  const json = decoded.nextString();
  if (!json) return null;
  try {
    const raw = JSON.parse(json);
    return {
      showLastSeen: !!raw.showLastSeen,
      showProfilePhoto: !!raw.showProfilePhoto,
      showBio: !!raw.showBio,
    };
  } catch {
    return null;
  }
}

export async function setBlocked(owner: string, target: string, blocked: boolean): Promise<void> {
  const contract = await getWriteContract();
  const args = new Args().addString(owner).addString(target).addBool(blocked);
  const op = await contract.call('set_blocked', args, {
    fee: 0n,
    maxGas: 300_000n,
    coins: 0n,
  });
  const status = await op.waitFinalExecution();
  if (status !== OperationStatus.Success) {
    throw new Error(`set_blocked failed with status ${OperationStatus[status] ?? status}`);
  }
}

export async function isBlocked(owner: string, target: string): Promise<boolean> {
  const contract = getReadContract();
  const args = new Args().addString(owner).addString(target);
  const res = await contract.read('is_blocked', args);
  if (!res.value?.length) return false;
  const decoded = new Args(res.value);
  return decoded.nextBool();
}

export async function touchLastSeen(address: string): Promise<void> {
  const contract = await getWriteContract();
  const args = new Args().addString(address);
  const op = await contract.call('touch_last_seen', args, {
    fee: 0n,
    maxGas: 250_000n,
    coins: 0n,
  });
  const status = await op.waitFinalExecution();
  if (status !== OperationStatus.Success) {
    throw new Error(`touch_last_seen failed with status ${OperationStatus[status] ?? status}`);
  }
}

export async function getLastSeen(address: string): Promise<bigint> {
  const contract = getReadContract();
  const args = new Args().addString(address);
  const res = await contract.read('get_last_seen', args);
  if (!res.value?.length) return 0n;
  const decoded = new Args(res.value);
  const value = decoded.nextU64();
  return BigInt(value);
}


