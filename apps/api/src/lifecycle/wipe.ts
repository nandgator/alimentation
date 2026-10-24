import { canonicalJson, sha256Hex } from '@alimentation/core';
import type { WorkspaceRow } from '../control/repo.ts';
import type { Bytes } from '../crypto/aead.ts';
import { readDsns } from '../directory.ts';
import { OUR_TABLES } from '../placement/external.ts';
import type { PlacementRef } from '../placement/types.ts';
import type { PlatformDeps } from '../platform/workspaces.ts';
import { notFound } from '../workspace/errors.ts';

/** How long a workspace that has moved away, or a database it left behind, is kept before it goes. */
export const UNDO_DAYS = 7;

export interface WipeReceipt {
  workspaceId: string;
  requestedAt: string;
  completedAt: string;
  manifest: Record<string, unknown>;
  digest: string;
}

export type WipeOutcome =
  | { done: true; receipt: WipeReceipt }
  /** The keys are already gone, so nothing can be read; removing the rest will be retried. */
  | { done: false; unreadable: true; retry: string };

/**
 * Removes a database and checks that it is gone. A database someone else owns loses
 * only what is ours (see `ExternalPlacement`). Safe to run again.
 */
export async function destroyDatabase(
  p: PlatformDeps,
  workspaceId: string,
  ref: PlacementRef,
  dsnEnc: Bytes,
): Promise<void> {
  const placement = p.placementFor(ref.kind);
  const dsns = await readDsns(p.keyring, workspaceId, dsnEnc);
  const creds = { ownerUrl: dsns.owner, appUrl: dsns.app };
  await placement.destroy(ref, creds);
  if (await placement.exists(ref, creds)) throw new Error('the database is still there');
}

/** Row counts per table, never contents: what the receipt can say was removed. */
async function countRows(
  p: PlatformDeps,
  row: WorkspaceRow,
): Promise<Record<string, number> | null> {
  try {
    const dsns = await readDsns(p.keyring, row.id, row.dsnEnc);
    const db = p.openDb(dsns.owner, { ephemeral: true });
    try {
      return await db.tx(async (tx) => {
        const out: Record<string, number> = {};
        for (const t of OUR_TABLES) {
          if (t === 'meta' || t === 'schema_migration') continue;
          out[t] = Number(
            (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.${t}`))[0]!.n,
          );
        }
        return out;
      });
    } finally {
      await db.close();
    }
  } catch {
    return null;
  }
}

/** A retired copy goes the way a wiped workspace does: its keys first, then the database. */
export async function destroyRetired(
  p: PlatformDeps,
  r: { id: string; workspaceId: string; placement: PlacementRef; dsnEnc: Bytes },
): Promise<void> {
  await p.control.shredRetired(r.id);
  await destroyDatabase(p, r.workspaceId, r.placement, r.dsnEnc);
  await p.control.deleteRetired(r.id);
}

/**
 * Wipes a workspace, in this order and no other:
 *
 *   1. destroy its keys. From here nothing it held can be read, wherever it was copied
 *   2. remove any old copy left from a move
 *   3. remove its database
 *   4. remove its records here (members, invitations, usage) and any account left with no workspace
 *   5. check each of those, and issue a receipt that names no one
 *
 * If a step after the first fails the workspace stays in `WIPING`, unreadable, and
 * housekeeping finishes it.
 */
export async function wipeWorkspace(p: PlatformDeps, workspaceId: string): Promise<WipeOutcome> {
  const row = await p.control.workspaceById(workspaceId);
  if (!row) {
    const done = await p.control.receipt(workspaceId);
    if (!done) throw notFound('Workspace');
    return { done: true, receipt: toReceipt(done) };
  }
  const requestedAt = p.now();
  const resumed = row.state === 'WIPING';
  // Counted before anything is destroyed, while the database can still be asked.
  const tables = resumed ? null : await countRows(p, row);
  const control = resumed ? null : await p.control.footprint(row.id);

  await p.control.destroyKeys(row.id);
  p.directory.invalidate(row.slug);

  try {
    const retired = await p.control.retiredOf(row.id);
    for (const r of retired) await destroyRetired(p, { ...r, workspaceId: row.id });
    await destroyDatabase(p, row.id, row.placement, row.dsnEnc);
    const { accountsRemoved } = await p.control.deleteWorkspaceAndOrphans(row.id);

    // Check before saying so.
    const left = await p.control.workspaceById(row.id);
    const footprint = await p.control.footprint(row.id);
    const checks = {
      keysDestroyed: true,
      databaseGone: !(await p
        .placementFor(row.placement.kind)
        .exists(row.placement, await credsOf(p, row))),
      directoryEntryGone: left === undefined && (await p.directory.bySlug(row.slug)) === undefined,
      controlRecordsGone: Object.values(footprint).every((n) => n === 0),
    };
    if (!Object.values(checks).every(Boolean)) throw new Error('a check after the wipe failed');

    const manifest: Record<string, unknown> = {
      placement: row.placement.kind,
      rowsRemoved: tables,
      recordsHere: control,
      accountsRemoved,
      oldCopiesRemoved: retired.length,
      checks,
      resumedAfterInterruption: resumed,
      remains: [
        'this receipt',
        'a count-only platform event (no names)',
        "the database host's own recovery copy of a deleted project, for up to 7 days, unreadable without the destroyed key",
        'request logs at the edge, for a few days, carrying only a pseudonym that can no longer be linked to anything',
      ],
    };
    const completedAt = p.now();
    const digest = await sha256Hex(
      canonicalJson({ workspaceId: row.id, requestedAt: requestedAt.toISOString(), manifest }),
    );
    await p.control.insertReceipt({ workspaceId: row.id, requestedAt, manifest, digest });
    await p.control.event('workspace.wiped', row.id, { placement: row.placement.kind });
    return {
      done: true,
      receipt: {
        workspaceId: row.id,
        requestedAt: requestedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        manifest,
        digest,
      },
    };
  } catch (e) {
    await p.control
      .event('workspace.wipe_retry', row.id, { step: String((e as Error).message).slice(0, 120) })
      .catch(() => undefined);
    return { done: false, unreadable: true, retry: 'The rest is removed within the hour.' };
  }
}

async function credsOf(p: PlatformDeps, row: WorkspaceRow) {
  const d = await readDsns(p.keyring, row.id, row.dsnEnc);
  return { ownerUrl: d.owner, appUrl: d.app };
}

export function toReceipt(r: Record<string, any>): WipeReceipt {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    workspaceId: r.workspace_id,
    requestedAt: r.requested_at,
    completedAt: r.completed_at,
    manifest: r.manifest,
    digest: r.digest,
  };
}
