import { fromBase64, toBase64Url } from '../crypto/aead.ts';

/**
 * Signed, expiring tokens for the session cookie and for the short-lived state of a
 * sign-in in progress. HMAC-SHA256; no database is consulted to check one. Several
 * secrets may be configured: the first signs, all verify, so they can be rotated.
 */

const te = new TextEncoder();
const td = new TextDecoder();

export class TokenSigner {
  private constructor(private readonly keys: CryptoKey[]) {}

  static async fromSecrets(secrets: string[]): Promise<TokenSigner> {
    if (secrets.length === 0) throw new Error('no session secret configured');
    const keys: CryptoKey[] = [];
    for (const s of secrets) {
      const raw = fromBase64(s);
      if (raw.length < 32) throw new Error('a session secret must be at least 32 bytes');
      keys.push(
        await crypto.subtle.importKey(
          'raw',
          raw as Uint8Array<ArrayBuffer>,
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign', 'verify'],
        ),
      );
    }
    return new TokenSigner(keys);
  }

  async sign<T extends object>(payload: T, ttlSeconds: number, now: Date): Promise<string> {
    const iat = Math.floor(now.getTime() / 1000);
    const body = toBase64Url(te.encode(JSON.stringify({ ...payload, iat, exp: iat + ttlSeconds })));
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', this.keys[0]!, te.encode(body)));
    return `${body}.${toBase64Url(mac)}`;
  }

  /** The payload, or null when the token is malformed, forged or expired. */
  async verify<T extends object>(
    token: string | undefined | null,
    now: Date,
  ): Promise<(T & { iat: number; exp: number }) | null> {
    if (!token) return null;
    const dot = token.indexOf('.');
    if (dot < 1 || token.length > 4096) return null;
    const body = token.slice(0, dot);
    let mac: Uint8Array<ArrayBuffer>;
    try {
      mac = Uint8Array.from(fromBase64(token.slice(dot + 1)));
    } catch {
      return null;
    }
    let ok = false;
    for (const key of this.keys) {
      if (await crypto.subtle.verify('HMAC', key, mac, te.encode(body))) ok = true;
    }
    if (!ok) return null;
    try {
      const payload = JSON.parse(td.decode(fromBase64(body))) as T & { iat: number; exp: number };
      return payload.exp > Math.floor(now.getTime() / 1000) ? payload : null;
    } catch {
      return null;
    }
  }
}

export interface SessionPayload {
  /** The account id. */
  a: string;
}

export const SESSION_TTL = 60 * 60 * 12;
