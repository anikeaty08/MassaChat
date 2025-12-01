import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

export type KeyPair = {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
};

export function generateKeyPair(): KeyPair {
  return nacl.box.keyPair();
}

export function encodePublicKey(key: Uint8Array): string {
  return naclUtil.encodeBase64(key);
}

export function decodePublicKey(key: string): Uint8Array {
  return naclUtil.decodeBase64(key);
}

export function encryptMessage(
  message: string,
  senderSecretKey: Uint8Array,
  recipientPublicKey: Uint8Array,
): { nonce: string; box: string } {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const boxed = nacl.box(
    naclUtil.decodeUTF8(message),
    nonce,
    recipientPublicKey,
    senderSecretKey,
  );
  return {
    nonce: naclUtil.encodeBase64(nonce),
    box: naclUtil.encodeBase64(boxed),
  };
}

export function decryptMessage(
  nonceB64: string,
  boxB64: string,
  senderPublicKey: Uint8Array,
  recipientSecretKey: Uint8Array,
): string | null {
  const nonce = naclUtil.decodeBase64(nonceB64);
  const boxed = naclUtil.decodeBase64(boxB64);
  const opened = nacl.box.open(boxed, nonce, senderPublicKey, recipientSecretKey);
  if (!opened) return null;
  return naclUtil.encodeUTF8(opened);
}



