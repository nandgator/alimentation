import { aesKey, fromBase64, hmacKey, open, randomBytes, seal, toHex, type Bytes } from './aead.ts';

/**
 * Keys, in three layers.
 *
 *   master key   held by the deployment (a secret), never stored in a database
 *   workspace keys  a data key (encrypts personal fields) and a log key (makes the
 *                   pseudonym that stands for the workspace in logs); stored
 *                   wrapped by the master key in the control database
 *   fields       encrypted by the data key
 *
 * Destroying the wrapped workspace keys makes the workspace's personal data
 * unreadable everywhere it has been copied, and makes its log pseudonym
 * impossible to recompute.
 */

export class Keyring {
  private constructor(
    private readonly keys: ReadonlyMap<number, CryptoKey>,
    private readonly current: number,
  ) {}

  /** `MASTER_KEYS` is `id:base64,id:base64`. The highest id wraps new keys; older ids still unwrap. */
  static async fromSpec(spec: string): Promise<Keyring> {
    const keys = new Map<number, CryptoKey>();
    for (const part of spec
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)) {
      const [id, b64] = part.split(':');
      const n = Number(id);
      if (!Number.isInteger(n) || n < 1 || n > 255 || !b64)
        throw new Error('MASTER_KEYS must look like 1:base64,2:base64');
      keys.set(n, await aesKey(fromBase64(b64)));
    }
    if (keys.size === 0) throw new Error('MASTER_KEYS is empty');
    return new Keyring(keys, Math.max(...keys.keys()));
  }

  /** A throwaway keyring, for tests and local development. */
  static async generate(): Promise<{ keyring: Keyring; spec: string }> {
    const raw = randomBytes(32);
    const spec = `1:${btoa(String.fromCharCode(...raw))}`;
    return { keyring: await Keyring.fromSpec(spec), spec };
  }

  /** `[1][key id][nonce][ciphertext][tag]`, bound to `aad`. */
  async wrap(raw: Bytes, aad: string): Promise<Bytes> {
    const sealed = await seal(this.keys.get(this.current)!, raw, aad);
    const out = new Uint8Array(new ArrayBuffer(sealed.length + 1));
    out[0] = sealed[0]!;
    out[1] = this.current;
    out.set(sealed.subarray(1), 2);
    return out;
  }

  async unwrap(blob: Bytes, aad: string): Promise<Bytes> {
    const key = this.keys.get(blob[1] ?? 0);
    if (!key) throw new Error('the master key that wrapped this is no longer configured');
    const sealed = new Uint8Array(new ArrayBuffer(blob.length - 1));
    sealed[0] = blob[0]!;
    sealed.set(blob.subarray(2), 1);
    return open(key, sealed, aad);
  }
}

export interface WrappedWorkspaceKeys {
  dataKeyWrapped: Bytes;
  logKeyWrapped: Bytes;
}

export interface WorkspaceKeys {
  data: CryptoKey;
  log: CryptoKey;
}

const dataAad = (workspaceId: string) => `workspace-data-key:${workspaceId}`;
const logAad = (workspaceId: string) => `workspace-log-key:${workspaceId}`;
export const dsnAad = (workspaceId: string) => `workspace-dsn:${workspaceId}`;

export async function newWorkspaceKeys(
  keyring: Keyring,
  workspaceId: string,
): Promise<WrappedWorkspaceKeys> {
  return {
    dataKeyWrapped: await keyring.wrap(randomBytes(32), dataAad(workspaceId)),
    logKeyWrapped: await keyring.wrap(randomBytes(32), logAad(workspaceId)),
  };
}

export async function loadWorkspaceKeys(
  keyring: Keyring,
  workspaceId: string,
  wrapped: { dataKeyWrapped: Bytes | null; logKeyWrapped: Bytes | null },
): Promise<WorkspaceKeys> {
  if (!wrapped.dataKeyWrapped || !wrapped.logKeyWrapped) throw new KeysDestroyedError();
  return {
    data: await aesKey(await keyring.unwrap(wrapped.dataKeyWrapped, dataAad(workspaceId))),
    log: await hmacKey(await keyring.unwrap(wrapped.logKeyWrapped, logAad(workspaceId))),
  };
}

export class KeysDestroyedError extends Error {
  constructor() {
    super("this workspace's keys have been destroyed");
    this.name = 'KeysDestroyedError';
  }
}

/** What logs call a workspace: 16 hex characters that cannot be reversed or recomputed without the log key. */
export async function pseudonym(keys: WorkspaceKeys, workspaceId: string): Promise<string> {
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', keys.log, new TextEncoder().encode(workspaceId)),
  );
  return toHex(mac.subarray(0, 8));
}
