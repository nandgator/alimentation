import type { ControlRepo, Wrapped } from '../control/repo.ts';
import { dataAad, logAad, Keyring } from '../crypto/keys.ts';
import { dsnAad } from '../crypto/keys.ts';

export interface RewrapReport {
  workspaces: number;
  retiredCopies: number;
  /** Rows that changed while this ran (a move, a wipe): run it again. */
  skipped: number;
  /** Rows still wrapped under an older master key afterwards. Zero means the old key can be retired. */
  stillOnOldKey: number;
}

const rewrapped = async (ring: Keyring, id: string, w: Wrapped): Promise<Wrapped> => ({
  dsnEnc: await ring.rewrap(w.dsnEnc, dsnAad(id)),
  dataKeyWrapped: await ring.rewrap(w.dataKeyWrapped, dataAad(id)),
  logKeyWrapped: await ring.rewrap(w.logKeyWrapped, logAad(id)),
});

const onCurrent = (ring: Keyring, w: Wrapped) =>
  [w.dsnEnc, w.dataKeyWrapped, w.logKeyWrapped].every((b) => Keyring.keyIdOf(b) === ring.currentId);

/**
 * Wraps every workspace's secrets (its connection strings and its two keys, and those of the
 * old copies a move left) under the current master key, so an older master key can be retired.
 *
 * Safe to run while the service is up and to run again: a row is only replaced if it is exactly
 * as it was read, so a move or a wipe that happens meanwhile wins, and keys that have been
 * destroyed are never brought back. The master keys still have to be configured until this
 * reports nothing left on an old key and every running instance has the new `MASTER_KEYS`.
 */
export async function rewrapAll(c: {
  control: ControlRepo;
  keyring: Keyring;
}): Promise<RewrapReport> {
  const r: RewrapReport = { workspaces: 0, retiredCopies: 0, skipped: 0, stillOnOldKey: 0 };
  for (const w of await c.control.allWorkspaces()) {
    if (!w.dataKeyWrapped || !w.logKeyWrapped) continue; // being wiped: nothing to protect
    const from: Wrapped = {
      dsnEnc: w.dsnEnc,
      dataKeyWrapped: w.dataKeyWrapped,
      logKeyWrapped: w.logKeyWrapped,
    };
    if (onCurrent(c.keyring, from)) continue;
    if (await c.control.rewrapWorkspace(w.id, from, await rewrapped(c.keyring, w.id, from)))
      r.workspaces++;
    else r.skipped++;
  }
  for (const old of await c.control.retiredWithKeys()) {
    const from: Wrapped = {
      dsnEnc: old.dsnEnc,
      dataKeyWrapped: old.dataKeyWrapped,
      logKeyWrapped: old.logKeyWrapped,
    };
    if (onCurrent(c.keyring, from)) continue;
    if (
      await c.control.rewrapRetired(old.id, from, await rewrapped(c.keyring, old.workspaceId, from))
    )
      r.retiredCopies++;
    else r.skipped++;
  }
  for (const w of await c.control.allWorkspaces())
    if (
      w.dataKeyWrapped &&
      w.logKeyWrapped &&
      !onCurrent(c.keyring, {
        dsnEnc: w.dsnEnc,
        dataKeyWrapped: w.dataKeyWrapped,
        logKeyWrapped: w.logKeyWrapped,
      })
    )
      r.stillOnOldKey++;
  for (const old of await c.control.retiredWithKeys())
    if (!onCurrent(c.keyring, old)) r.stillOnOldKey++;
  return r;
}
