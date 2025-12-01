// @ts-nocheck
// AssemblyScript smart contract; types like `u64`, `StaticArray<u8>` and host
// functions are provided by the Massa AS SDK and AssemblyScript runtime.
import { Storage, Context, generateEvent } from '@massalabs/massa-as-sdk';

// Storage key helpers
function lastIndexKey(convId: string): string {
  return 'conv:' + convId + ':last';
}

function messageKey(convId: string, index: u64): string {
  return 'conv:' + convId + ':msg:' + index.toString();
}

// Encoding helpers
function strToBytes(str: string): StaticArray<u8> {
  return changetype<StaticArray<u8>>(String.UTF8.encode(str));
}

function bytesToStr(bytes: StaticArray<u8>): string {
  return String.UTF8.decode(changetype<ArrayBuffer>(bytes));
}

// Message model (stored as JSON string, no plaintext content)
class Message {
  cid: string;
  timestamp: u64;

  constructor(cid: string, timestamp: u64) {
    this.cid = cid;
    this.timestamp = timestamp;
  }

  toJSON(): string {
    return (
      '{"cid":"' +
      this.cid +
      '","timestamp":' +
      this.timestamp.toString() +
      '}'
    );
  }
}

// Initialize contract state if needed
export function init(): void {
  generateEvent('chat:init');
}

// Add an encrypted message CID to a conversation.
// Stores ONLY encrypted CID and metadata on-chain.
export function add_message(convId: string, cid: string): u64 {
  const now: u64 = Context.timestamp();

  let lastIndex: u64 = 0;
  const keyStr = lastIndexKey(convId);
  const key = strToBytes(keyStr);

  if (Storage.has(key)) {
    const rawBytes = Storage.get(key);
    const raw = bytesToStr(rawBytes);
    // Stored last index as string; parse back to u64 via I64 and cast.
    lastIndex = <u64>I64.parseInt(raw);
  }

  const newIndex = lastIndex + 1;
  const msg = new Message(cid, now);

  const msgKey = strToBytes(messageKey(convId, newIndex));
  Storage.set(msgKey, strToBytes(msg.toJSON()));
  Storage.set(key, strToBytes(newIndex.toString()));

  generateEvent(
    'chat:message:' + convId + ':' + newIndex.toString(),
  );

  return newIndex;
}

// Get a specific encrypted message by conversation and index.
// Returns the stored JSON string.
export function get_message(convId: string, index: u64): string {
  const key = strToBytes(messageKey(convId, index));
  if (!Storage.has(key)) {
    return '';
  }
  const bytes = Storage.get(key);
  return bytesToStr(bytes);
}

// Get the last index for a conversation.
export function get_last_index(convId: string): u64 {
  const key = strToBytes(lastIndexKey(convId));
  if (!Storage.has(key)) {
    return 0;
  }
  const raw = bytesToStr(Storage.get(key));
  // Parse stored last index string back into u64.
  return <u64>I64.parseInt(raw);
}


