// @ts-nocheck
// AssemblyScript smart contract; types like `u64`, `StaticArray<u8>` and host
// functions are provided by the Massa AS SDK and AssemblyScript runtime.
import { Storage, Context, generateEvent } from '@massalabs/massa-as-sdk';

// --------------- Encoding helpers ---------------

function strToBytes(str: string): StaticArray<u8> {
  return changetype<StaticArray<u8>>(String.UTF8.encode(str));
}

function bytesToStr(bytes: StaticArray<u8>): string {
  return String.UTF8.decode(changetype<ArrayBuffer>(bytes));
}

function toLowerAscii(str: string): string {
  const len = str.length;
  const chars = new Array<string>(len);
  for (let i = 0; i < len; i++) {
    const code = str.charCodeAt(i);
    if (code >= 65 && code <= 90) {
      chars[i] = String.fromCharCode(code + 32);
    } else {
      chars[i] = str.charAt(i);
    }
  }
  return chars.join('');
}

// --------------- Storage key helpers ---------------

// Conversation keys (messages still supported for backward compatibility)
function lastIndexKey(convId: string): string {
  return 'conv:' + convId + ':last';
}

function messageKey(convId: string, index: u64): string {
  return 'conv:' + convId + ':msg:' + index.toString();
}

// Profile + username registry
function profileKey(address: string): string {
  return 'profile:' + address;
}

function usernameIndexKey(usernameLower: string): string {
  return 'uname:' + usernameLower;
}

// Privacy settings
function privacyKey(address: string): string {
  return 'privacy:' + address;
}

// Block list (address -> target address)
function blockKey(owner: string, target: string): string {
  return 'block:' + owner + ':' + target;
}

// Last seen timestamps
function lastSeenKey(address: string): string {
  return 'lastseen:' + address;
}

// --------------- Models ---------------

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

// Profile model – kept as JSON in storage for simplicity.
class Profile {
  address: string;
  username: string;
  displayName: string;
  avatarCid: string;
  bio: string;
  createdAt: u64;
  updatedAt: u64;

  constructor(
    address: string,
    username: string,
    displayName: string,
    avatarCid: string,
    bio: string,
    createdAt: u64,
    updatedAt: u64,
  ) {
    this.address = address;
    this.username = username;
    this.displayName = displayName;
    this.avatarCid = avatarCid;
    this.bio = bio;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  toJSON(): string {
    return (
      '{"address":"' +
      this.address +
      '","username":"' +
      this.username +
      '","displayName":"' +
      this.displayName +
      '","avatarCid":"' +
      this.avatarCid +
      '","bio":"' +
      this.bio +
      '","createdAt":' +
      this.createdAt.toString() +
      ',"updatedAt":' +
      this.updatedAt.toString() +
      '}'
    );
  }
}

// Privacy config for a given address.
class Privacy {
  showLastSeen: bool;
  showProfilePhoto: bool;
  showBio: bool;

  constructor(showLastSeen: bool, showProfilePhoto: bool, showBio: bool) {
    this.showLastSeen = showLastSeen;
    this.showProfilePhoto = showProfilePhoto;
    this.showBio = showBio;
  }

  toJSON(): string {
    return (
      '{"showLastSeen":' +
      (this.showLastSeen ? 'true' : 'false') +
      ',"showProfilePhoto":' +
      (this.showProfilePhoto ? 'true' : 'false') +
      ',"showBio":' +
      (this.showBio ? 'true' : 'false') +
      '}'
    );
  }
}

// --------------- Core lifecycle ---------------

export function init(): void {
  generateEvent('chat:init');
}

// --------------- Profile & username registry ---------------

/**
 * Register or update a user profile for a given wallet address.
 *
 * NOTE: `ownerAddress` must match the wallet the dApp is using. On-chain we cannot
 * verify signatures here, so this is primarily for demo / dApp-level enforcement.
 */
export function register_profile(
  ownerAddress: string,
  username: string,
  displayName: string,
  avatarCid: string,
  bio: string,
): void {
  const now: u64 = Context.timestamp();
  const unameLower = toLowerAscii(username);

  // Enforce non-empty username
  assert(username.length > 0, 'username required');

  // Ensure uniqueness of username (by lower-cased index)
  const unameKey = strToBytes(usernameIndexKey(unameLower));
  if (Storage.has(unameKey)) {
    const existingOwner = bytesToStr(Storage.get(unameKey));
    if (existingOwner != ownerAddress) {
      assert(false, 'username already taken');
    }
  }

  const pKey = strToBytes(profileKey(ownerAddress));
  let createdAt: u64 = now;

  if (Storage.has(pKey)) {
    // Preserve original createdAt if profile already exists
    const existingRaw = bytesToStr(Storage.get(pKey));
    const createdIdx = existingRaw.indexOf('"createdAt":');
    if (createdIdx >= 0) {
      const slice = existingRaw.slice(createdIdx + 12);
      const end = slice.indexOf(',');
      if (end > 0) {
        const numStr = slice.substring(0, end);
        createdAt = <u64>I64.parseInt(numStr);
      }
    }
  }

  const profile = new Profile(
    ownerAddress,
    username,
    displayName,
    avatarCid,
    bio,
    createdAt,
    now,
  );

  Storage.set(pKey, strToBytes(profile.toJSON()));
  Storage.set(unameKey, strToBytes(ownerAddress));

  generateEvent('profile:upsert:' + ownerAddress);
}

/**
 * Get profile by address. Returns profile JSON string or "".
 */
export function get_profile_by_address(address: string): string {
  const pKey = strToBytes(profileKey(address));
  if (!Storage.has(pKey)) {
    return '';
  }
  return bytesToStr(Storage.get(pKey));
}

/**
 * Get profile by username (case-insensitive). Returns profile JSON string or "".
 */
export function get_profile_by_username(username: string): string {
  const unameLower = toLowerAscii(username);
  const uKey = strToBytes(usernameIndexKey(unameLower));
  if (!Storage.has(uKey)) {
    return '';
  }
  const owner = bytesToStr(Storage.get(uKey));
  return get_profile_by_address(owner);
}

// --------------- Privacy settings ---------------

export function set_privacy(
  ownerAddress: string,
  showLastSeen: bool,
  showProfilePhoto: bool,
  showBio: bool,
): void {
  const cfg = new Privacy(showLastSeen, showProfilePhoto, showBio);
  const key = strToBytes(privacyKey(ownerAddress));
  Storage.set(key, strToBytes(cfg.toJSON()));
  generateEvent('privacy:update:' + ownerAddress);
}

/**
 * Returns privacy JSON string or "" if none was set.
 */
export function get_privacy(address: string): string {
  const key = strToBytes(privacyKey(address));
  if (!Storage.has(key)) {
    return '';
  }
  return bytesToStr(Storage.get(key));
}

// --------------- Block list ---------------

/**
 * Set or unset `target` as blocked by `owner`.
 */
export function set_blocked(owner: string, target: string, blocked: bool): void {
  const key = strToBytes(blockKey(owner, target));
  if (blocked) {
    Storage.set(key, strToBytes('1'));
    generateEvent('block:set:' + owner + ':' + target);
  } else {
    if (Storage.has(key)) {
      Storage.del(key);
    }
    generateEvent('block:clear:' + owner + ':' + target);
  }
}

export function is_blocked(owner: string, target: string): bool {
  const key = strToBytes(blockKey(owner, target));
  return Storage.has(key);
}

// --------------- Last seen ---------------

/**
 * Update last-seen timestamp for a given address.
 * In a real app this would be bound to the caller; here we accept the address for demo.
 */
export function touch_last_seen(address: string): void {
  const key = strToBytes(lastSeenKey(address));
  const now: u64 = Context.timestamp();
  Storage.set(key, strToBytes(now.toString()));
}

/**
 * Returns last-seen timestamp as u64 (0 if never set).
 */
export function get_last_seen(address: string): u64 {
  const key = strToBytes(lastSeenKey(address));
  if (!Storage.has(key)) {
    return 0;
  }
  const raw = bytesToStr(Storage.get(key));
  return <u64>I64.parseInt(raw);
}

// --------------- Messaging (existing features) ---------------

/**
 * Add an encrypted message CID to a conversation.
 * Stores ONLY encrypted CID and metadata on-chain.
 */
export function add_message(convId: string, cid: string): u64 {
  const now: u64 = Context.timestamp();

  let lastIndex: u64 = 0;
  const keyStr = lastIndexKey(convId);
  const key = strToBytes(keyStr);

  if (Storage.has(key)) {
    const rawBytes = Storage.get(key);
    const raw = bytesToStr(rawBytes);
    lastIndex = <u64>I64.parseInt(raw);
  }

  const newIndex = lastIndex + 1;
  const msg = new Message(cid, now);

  const msgKey = strToBytes(messageKey(convId, newIndex));
  Storage.set(msgKey, strToBytes(msg.toJSON()));
  Storage.set(key, strToBytes(newIndex.toString()));

  generateEvent('chat:message:' + convId + ':' + newIndex.toString());

  return newIndex;
}

/**
 * Get a specific encrypted message by conversation and index.
 * Returns the stored JSON string or "".
 */
export function get_message(convId: string, index: u64): string {
  const key = strToBytes(messageKey(convId, index));
  if (!Storage.has(key)) {
    return '';
  }
  const bytes = Storage.get(key);
  return bytesToStr(bytes);
}

/**
 * Get the last index for a conversation.
 */
export function get_last_index(convId: string): u64 {
  const key = strToBytes(lastIndexKey(convId));
  if (!Storage.has(key)) {
    return 0;
  }
  const raw = bytesToStr(Storage.get(key));
  return <u64>I64.parseInt(raw);
}

