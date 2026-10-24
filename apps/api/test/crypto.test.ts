import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  aesKey,
  fieldAad,
  open,
  OpenError,
  randomBytes,
  seal,
  sealText,
  openText,
} from '../src/crypto/aead.ts';
import { FieldCipher } from '../src/crypto/fields.ts';
import {
  KeysDestroyedError,
  Keyring,
  loadWorkspaceKeys,
  newWorkspaceKeys,
  pseudonym,
} from '../src/crypto/keys.ts';

const key = () => aesKey(randomBytes(32));

describe('[P5] fields are sealed to their place', () => {
  it('round-trips any text', async () => {
    const k = await key();
    await fc.assert(
      fc.asyncProperty(fc.string({ unit: 'binary' }), async (text) => {
        const blob = await sealText(k, text, 'person.name_enc:1');
        expect(await openText(k, blob, 'person.name_enc:1')).toBe(text);
      }),
      { numRuns: 100 },
    );
  });

  it('writes the layout the database domain checks: version byte 1 and at least 29 bytes', async () => {
    const k = await key();
    const empty = await sealText(k, '', 'a');
    expect(empty[0]).toBe(1);
    expect(empty.length).toBe(29);
    const some = await sealText(k, 'Jovial', 'a');
    expect(some.length).toBe(29 + 6);
  });

  it('never shows the text in what it stores, and never repeats a ciphertext', async () => {
    const k = await key();
    const a = await sealText(k, 'Jovial Fernandes', 'a');
    const b = await sealText(k, 'Jovial Fernandes', 'a');
    expect(Buffer.from(a).toString('latin1')).not.toContain('Jovial');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('refuses a ciphertext moved to another row or column', async () => {
    const k = await key();
    const blob = await sealText(k, 'Jovial', fieldAad('person', 'name_enc', 'row-1'));
    await expect(openText(k, blob, fieldAad('person', 'name_enc', 'row-2'))).rejects.toBeInstanceOf(
      OpenError,
    );
    await expect(
      openText(k, blob, fieldAad('person', 'contact_enc', 'row-1')),
    ).rejects.toBeInstanceOf(OpenError);
    expect(await openText(k, blob, fieldAad('person', 'name_enc', 'row-1'))).toBe('Jovial');
  });

  it('refuses a wrong key, an altered byte, a truncated blob and a wrong version', async () => {
    const [k, other] = [await key(), await key()];
    const blob = await seal(k, new Uint8Array([1, 2, 3]), 'a');
    await expect(open(other, blob, 'a')).rejects.toBeInstanceOf(OpenError);
    for (const i of [1, 13, blob.length - 1]) {
      const bad = blob.slice();
      bad[i] = bad[i]! ^ 1;
      await expect(open(k, bad, 'a'), `byte ${i}`).rejects.toBeInstanceOf(OpenError);
    }
    await expect(open(k, blob.subarray(0, 20), 'a')).rejects.toBeInstanceOf(OpenError);
    const v2 = blob.slice();
    v2[0] = 2;
    await expect(open(k, v2, 'a')).rejects.toBeInstanceOf(OpenError);
  });

  it('rejects keys of the wrong size', async () => {
    await expect(aesKey(new Uint8Array(16))).rejects.toThrow(/32 bytes/);
  });
});

describe('[P4] keys can be destroyed, and then nothing is readable', () => {
  it('wraps workspace keys under the master key, bound to the workspace', async () => {
    const { keyring } = await Keyring.generate();
    const wrapped = await newWorkspaceKeys(keyring, 'ws-1');
    const keys = await loadWorkspaceKeys(keyring, 'ws-1', wrapped);
    const blob = await sealText(keys.data, 'Jovial', 'x');
    expect(await openText(keys.data, blob, 'x')).toBe('Jovial');
    await expect(loadWorkspaceKeys(keyring, 'ws-2', wrapped)).rejects.toBeInstanceOf(OpenError);
  });

  it('cannot open anything once the wrapped keys are gone', async () => {
    const { keyring } = await Keyring.generate();
    const wrapped = await newWorkspaceKeys(keyring, 'ws-1');
    const cipher = new FieldCipher(await loadWorkspaceKeys(keyring, 'ws-1', wrapped));
    const stored = await cipher.enc('person', 'name_enc', 'p1', 'Jovial');
    expect(await cipher.dec('person', 'name_enc', 'p1', stored)).toBe('Jovial');
    await expect(
      loadWorkspaceKeys(keyring, 'ws-1', { dataKeyWrapped: null, logKeyWrapped: null }),
    ).rejects.toBeInstanceOf(KeysDestroyedError);
    // A fresh key for the same workspace cannot read the old data either.
    const reborn = await newWorkspaceKeys(keyring, 'ws-1');
    const other = new FieldCipher(await loadWorkspaceKeys(keyring, 'ws-1', reborn));
    await expect(other.dec('person', 'name_enc', 'p1', stored)).rejects.toBeInstanceOf(OpenError);
  });

  it('opens keys wrapped under an older master key after the master key is rotated', async () => {
    const first = await Keyring.generate();
    const wrapped = await newWorkspaceKeys(first.keyring, 'ws-1');
    const second = btoa(String.fromCharCode(...randomBytes(32)));
    const rotated = await Keyring.fromSpec(`${first.spec},2:${second}`);
    await loadWorkspaceKeys(rotated, 'ws-1', wrapped);
    const fresh = await newWorkspaceKeys(rotated, 'ws-9');
    expect(fresh.dataKeyWrapped[1]).toBe(2); // new keys use the newest master key
    await expect(loadWorkspaceKeys(first.keyring, 'ws-9', fresh)).rejects.toThrow(
      /no longer configured/,
    );
  });

  it('refuses a malformed key ring', async () => {
    await expect(Keyring.fromSpec('')).rejects.toThrow(/empty/);
    await expect(Keyring.fromSpec('one:abc')).rejects.toThrow(/must look like/);
    await expect(Keyring.fromSpec('1:' + btoa('short'))).rejects.toThrow(/32 bytes/);
  });

  it('names a workspace in logs by a pseudonym that changes with the log key', async () => {
    const { keyring } = await Keyring.generate();
    const a = await loadWorkspaceKeys(keyring, 'ws-1', await newWorkspaceKeys(keyring, 'ws-1'));
    const b = await loadWorkspaceKeys(keyring, 'ws-1', await newWorkspaceKeys(keyring, 'ws-1'));
    const p1 = await pseudonym(a, 'ws-1');
    expect(p1).toMatch(/^[0-9a-f]{16}$/);
    expect(await pseudonym(a, 'ws-1')).toBe(p1); // stable while the key lives
    expect(await pseudonym(b, 'ws-1')).not.toBe(p1); // unlinkable once it is replaced or gone
    expect(await pseudonym(a, 'ws-2')).not.toBe(p1);
  });
});
