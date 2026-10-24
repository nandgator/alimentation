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
  // Even finding out what there is to do can fail; that must not stop the other kinds of work.
  const each = async <T>(what: string, list: () => Promise<T[]>, fn: (x: T) => Promise<void>) => {
    let items: T[] = [];
    await guard(`list ${what}`, async () => void (items = await list()));
    for (const x of items) await guard(what, () => fn(x));
  };

  await each(
    'finish wipe',
    () => p.control.wiping(),
    async (w) => {
      if ((await wipeWorkspace(p, w.id)).done) r.wipesFinished++;
    },
  );
  await each(
    'wipe again',
    () => p.control.wipedButPresent(),
    async (w) => {
      if ((await wipeWorkspace(p, w.id)).done) r.wipedAgain++;
    },
  );
  await each(
    'wipe moved copy',
    () => p.control.movedBefore(new Date(now.getTime() - UNDO_DAYS * DAY)),
    async (w) => {
      if ((await wipeWorkspace(p, w.id)).done) r.movedCopiesWiped++;
    },
  );
  await each(
    'remove old copy',
    () => p.control.retiredDue(now),
    async (old) => {
      await destroyRetired(p, old);
      r.oldCopiesRemoved++;
    },
  );
  await each(
    'release stalled move',
    () => p.control.stuckMoving(new Date(now.getTime() - MOVE_PATIENCE_MS)),
    async (w) => {
      if (w.movedToUrl) {
        r.needAttention.push(w.slug);
        return;
      }
      await releaseMove(p, w.id);
      r.stalledMovesReleased++;
    },
  );

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

/** Timers a scheduler uses; a test supplies its own. Each returns the way to cancel. */
export interface Timers {
  after(ms: number, fn: () => void): () => void;
  every(ms: number, fn: () => void): () => void;
}

const realTimers: Timers = {
  after(ms, fn) {
    const t = setTimeout(fn, ms);
    t.unref?.(); // a timer alone does not keep the process alive
    return () => clearTimeout(t);
  },
  every(ms, fn) {
    const t = setInterval(fn, ms);
    t.unref?.();
    return () => clearInterval(t);
  },
};

/**
 * For a server that stays up: runs housekeeping soon after it starts and then on a timer, and
 * never lets a failure stop the next run. Returns a function that stops it. (On Cloudflare the
 * platform's own scheduler calls `housekeeping` instead.)
 */
export function scheduleHousekeeping(
  p: PlatformDeps,
  o: {
    everyMs?: number;
    firstAfterMs?: number;
    onReport?: (r: HousekeepingReport) => void;
    onError?: (e: unknown) => void;
    timers?: Timers;
  } = {},
): () => void {
  const timers = o.timers ?? realTimers;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const report = await housekeeping(p);
      o.onReport?.(report);
    } catch (e) {
      o.onError?.(e);
    } finally {
      running = false;
    }
  };
  const stopFirst = timers.after(o.firstAfterMs ?? 60_000, () => void tick());
  const stopEvery = timers.every(o.everyMs ?? 15 * 60_000, () => void tick());
  return () => {
    stopFirst();
    stopEvery();
  };
}
