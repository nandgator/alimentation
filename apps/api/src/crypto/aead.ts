/**
 * Authenticated encryption for personal data, on WebCrypto so the same code runs
 * on Workers and on Node.
 *
 * A field is stored as `[1][nonce 12][ciphertext][tag 16]`. The first byte and the
 * minimum length are what the database's `enc_blob` domain checks, so plain text
 * cannot be stored in a personal column by mistake. The additional authenticated
 * data names the table, column and row, so a ciphertext copied into another row or
 * column fails to open instead of showing someone else's details.
 */

/** Byte arrays backed by a plain ArrayBuffer, which is what WebCrypto accepts. */
export type Bytes = Uint8Array<ArrayBuffer>;

const te = new TextEncoder();
const td = new TextDecoder();

export const FIELD_VERSION = 1;
const NONCE = 12;
const TAG = 16;

export function randomBytes(n: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));
}

export async function aesKey(raw: Bytes): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error('an AES-256 key is 32 bytes');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function hmacKey(raw: Bytes): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error('an HMAC key is 32 bytes here');
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function seal(key: CryptoKey, plaintext: Bytes, aad: string): Promise<Bytes> {
  const iv = randomBytes(NONCE);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: te.encode(aad) },
      key,
      plaintext,
    ),
  );
  const out = new Uint8Array(1 + NONCE + ct.length);
  out[0] = FIELD_VERSION;
  out.set(iv, 1);
  out.set(ct, 1 + NONCE);
  return out;
}

export class OpenError extends Error {
  constructor() {
    super('could not open: wrong key, wrong place, or altered');
    this.name = 'OpenError';
  }
}

export async function open(key: CryptoKey, blob: Bytes, aad: string): Promise<Bytes> {
  if (blob.length < 1 + NONCE + TAG || blob[0] !== FIELD_VERSION) throw new OpenError();
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: blob.subarray(1, 1 + NONCE), additionalData: te.encode(aad) },
        key,
        blob.subarray(1 + NONCE),
      ),
    );
  } catch {
    throw new OpenError();
  }
}

export const sealText = (key: CryptoKey, text: string, aad: string) =>
  seal(key, te.encode(text), aad);
export const openText = async (key: CryptoKey, blob: Bytes, aad: string) =>
  td.decode(await open(key, blob, aad));

/** Where a field lives; part of what its ciphertext is bound to. */
export const fieldAad = (table: string, column: string, rowId: string): string =>
  `${table}.${column}:${rowId}`;

export function toHex(b: Bytes): string {
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function fromBase64(s: string): Bytes {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function toBase64Url(b: Bytes): string {
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Compares two secrets without stopping at the first difference. */
export async function sameSecret(a: string, b: string): Promise<boolean> {
  const h = async (x: string) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(x)));
  const [x, y] = await Promise.all([h(a), h(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}
