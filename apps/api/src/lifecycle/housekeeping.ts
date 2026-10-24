import type { PlatformDeps } from '../platform/workspaces.ts';
import { releaseMove } from './move.ts';
import { UNDO_DAYS, destroyRetired, wipeWorkspace } from './wipe.ts';

const DAY = 86_400_000;
const MOVE_PATIENCE_MS = 30 * 60_000;

export interface HousekeepingReport {
  wipesFinished: number;
  /** Workspaces that came back from a restore of the control database and were wiped again. */
  wipedAgain: number;
  movedCopiesWiped: number;
  oldCopiesRemoved: number;
  stalledMovesReleased: number;
  /** Moves that stopped after sending data away; only a person can say which side is the real one. */
  needAttention: string[];
  usageRowsPruned: number;
  invitesPruned: number;
  errors: string[];
}

/**
 * The slow work: finishes wipes that stopped part-way, removes workspaces that moved
 * away more than a week ago, removes the old databases left by moves, frees moves
 * that stalled before sending anything, and drops counts nobody reads any more.
 * Each piece is independent, so one failing does not stop the rest. Safe to run as
 * often as wanted.
 */
export async function housekeeping(p: PlatformDeps): Promise<HousekeepingReport> {
  const now = p.now();
  const r: HousekeepingReport = {
    wipesFinished: 0,
    wipedAgain: 0,
    movedCopiesWiped: 0,
    oldCopiesRemoved: 0,
    stalledMovesReleased: 0,
    needAttention: [],
    usageRowsPruned: 0,
    invitesPruned: 0,
    errors: [],
  };
  const guard = async (what: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      r.errors.push(`${what}: ${String((e as Error).message).slice(0, 120)}`);
    }
  };

  for (const w of await p.control.wiping())
    await guard('finish wipe', async () => {
      if ((await wipeWorkspace(p, w.id)).done) r.wipesFinished++;
    });

  for (const w of await p.control.wipedButPresent())
    await guard('wipe again', async () => {
      if ((await wipeWorkspace(p, w.id)).done) r.wipedAgain++;
    });

  for (const w of await p.control.movedBefore(new Date(now.getTime() - UNDO_DAYS * DAY)))
    await guard('wipe moved copy', async () => {
      if ((await wipeWorkspace(p, w.id)).done) r.movedCopiesWiped++;
    });

  for (const old of await p.control.retiredDue(now))
    await guard('remove old copy', async () => {
      await destroyRetired(p, old);
      r.oldCopiesRemoved++;
    });

  for (const w of await p.control.stuckMoving(new Date(now.getTime() - MOVE_PATIENCE_MS)))
    await guard('release stalled move', async () => {
      if (w.movedToUrl) {
        r.needAttention.push(w.slug);
        return;
      }
      await releaseMove(p, w.id);
      r.stalledMovesReleased++;
    });

  await guard('prune usage', async () => {
    r.usageRowsPruned = await p.control.pruneUsage(
      new Date(now.getTime() - 35 * DAY).toISOString().slice(0, 10),
    );
  });
  await guard('prune invitations', async () => {
    r.invitesPruned = await p.control.pruneInvites(new Date(now.getTime() - 30 * DAY));
  });
  return r;
}
