import dotenv from 'dotenv';
import { JsonRpcPublicProvider } from '@massalabs/massa-web3';

dotenv.config();

const CHAT_CONTRACT_ADDRESS = process.env.CHAT_CONTRACT_ADDRESS;
const RPC_URL = process.env.MASSA_PUBLIC_API_URL;
const THREAD_COUNT = Number(process.env.MASSA_THREAD_COUNT ?? '32');
const PERIOD_WINDOW = BigInt(process.env.MASSA_PERIOD_WINDOW ?? '20');

function createSlot(periodBigInt) {
  return {
    period: Number(periodBigInt),
    thread: THREAD_COUNT - 1,
  };
}

async function main() {
  if (!CHAT_CONTRACT_ADDRESS) {
    console.error('CHAT_CONTRACT_ADDRESS env var not set, indexer exiting.');
    process.exit(1);
  }

  const provider = RPC_URL
    ? JsonRpcPublicProvider.fromRPCUrl(RPC_URL)
    : JsonRpcPublicProvider.buildnet();

  console.log('Starting Massa chat indexer…');

  let lastPeriod = 0n;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const events = await provider.getEvents({
        start: { period: Number(lastPeriod), thread: 0 },
        end: createSlot(lastPeriod + PERIOD_WINDOW),
        emitter_address: CHAT_CONTRACT_ADDRESS,
        is_final: true,
      });

      for (const event of events) {
        console.log('SC Event:', event);
      }

      lastPeriod += PERIOD_WINDOW;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch (err) {
      console.error('Indexer error', err);
      await new Promise((resolve) => setTimeout(resolve, 8000));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


