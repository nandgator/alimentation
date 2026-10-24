import type { Limits } from '@alimentation/core';
import type { ControlRepo } from '../control/repo.ts';

/**
 * Keeps one workspace from using up everyone's share of a free host's daily
 * request allowance. Three checks, cheapest first:
 *
 *   rate    a token bucket per workspace stops floods
 *   daily   a workspace past a multiple of its own budget is refused for the day
 *   global  when the whole platform nears the host's daily cap, only workspaces
 *           still inside their own budget are served
 *
 * Counts are kept in memory and written to the control database in batches, so a
 * request normally costs no database write. They are approximate across instances
 * on purpose: this is fairness, not metering. The hard guarantee on a free host is
 * the host's own cap; this decides who gets turned away first.
 */

export interface GateOptions {
  control: ControlRepo;
  now: () => Date;
  hardCapFactor: number;
  /** The host's daily request cap for the whole account. */
  accountDailyCap: number;
  /** Share of the cap kept for system traffic. */
  headroom: number;
  burst?: number;
  refillPerSecond?: number;
  flushAfter?: number;
  flushMs?: number;
  refreshMs?: number;
  /** Lets a host run background work after the response (Workers' `waitUntil`). */
  schedule?: (p: Promise<unknown>) => void;
}

export type GateVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'rate' | 'daily' | 'global'; retryAfterSeconds: number };

interface Bucket {
  tokens: number;
  at: number;
}

export class Gate {
  private readonly buckets = new Map<string, Bucket>();
  private pending = new Map<string, { requests: number; rejected: number }>();
  private lastFlush = 0;
  private cache:
    { day: string; at: number; total: number; byWorkspace: Map<string, number> } | undefined;
  private flushing: Promise<void> | undefined;

  constructor(private readonly o: GateOptions) {}

  private day(): string {
    return this.o.now().toISOString().slice(0, 10);
  }

  private secondsToMidnight(): number {
    const n = this.o.now();
    return Math.max(
      1,
      Math.ceil(
        (Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1) - n.getTime()) / 1000,
      ),
    );
  }

  private async snapshot(): Promise<NonNullable<Gate['cache']>> {
    const day = this.day();
    const at = this.o.now().getTime();
    if (
      !this.cache ||
      this.cache.day !== day ||
      at - this.cache.at > (this.o.refreshMs ?? 30_000)
    ) {
      const { total, byWorkspace } = await this.o.control.requestsToday(day);
      this.cache = { day, at, total, byWorkspace };
    }
    return this.cache;
  }

  /**
   * `essential` requests (taking a copy of your own data) are still counted and still rate
   * limited, but are never turned away for using up the day's budget: that is a promise.
   */
  async admit(
    ws: { id: string; limits: Limits },
    opts: { essential?: boolean } = {},
  ): Promise<GateVerdict> {
    const now = this.o.now().getTime();
    const b = this.buckets.get(ws.id) ?? { tokens: this.o.burst ?? 40, at: now };
    b.tokens = Math.min(
      this.o.burst ?? 40,
      // A clock that steps back (a time sync, another machine's clock) must not drain the bucket.
      b.tokens + (Math.max(0, now - b.at) / 1000) * (this.o.refillPerSecond ?? 2),
    );
    b.at = now;
    this.buckets.set(ws.id, b);
    if (b.tokens < 1) return this.refuse(ws.id, 'rate', 1);
    b.tokens -= 1;

    const snap = await this.snapshot();
    const mine = (snap.byWorkspace.get(ws.id) ?? 0) + (this.pending.get(ws.id)?.requests ?? 0);
    if (!opts.essential && mine >= ws.limits.requestsPerDay * this.o.hardCapFactor)
      return this.refuse(ws.id, 'daily', this.secondsToMidnight());
    let pendingTotal = 0;
    for (const p of this.pending.values()) pendingTotal += p.requests;
    const nearCap = snap.total + pendingTotal >= this.o.accountDailyCap * (1 - this.o.headroom / 2);
    if (!opts.essential && nearCap && mine >= ws.limits.requestsPerDay)
      return this.refuse(ws.id, 'global', this.secondsToMidnight());

    const p = this.pending.get(ws.id) ?? { requests: 0, rejected: 0 };
    p.requests++;
    this.pending.set(ws.id, p);
    this.maybeFlush();
    return { allowed: true };
  }

  private refuse(
    id: string,
    reason: 'rate' | 'daily' | 'global',
    retryAfterSeconds: number,
  ): GateVerdict {
    const p = this.pending.get(id) ?? { requests: 0, rejected: 0 };
    p.rejected++;
    this.pending.set(id, p);
    this.maybeFlush();
    return { allowed: false, reason, retryAfterSeconds };
  }

  private maybeFlush(): void {
    let n = 0;
    for (const p of this.pending.values()) n += p.requests + p.rejected;
    const due =
      n >= (this.o.flushAfter ?? 25) ||
      this.o.now().getTime() - this.lastFlush > (this.o.flushMs ?? 20_000);
    if (!due || this.flushing) return;
    const work = this.flush();
    this.o.schedule?.(work);
  }

  /** Writes the counts gathered so far. Safe to call at any time. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const batch = this.pending;
    this.pending = new Map();
    this.lastFlush = this.o.now().getTime();
    const day = this.day();
    this.flushing = (async () => {
      try {
        for (const [id, c] of batch)
          if (c.requests || c.rejected)
            await this.o.control.addUsage(id, day, c.requests, c.rejected);
        if (this.cache) {
          for (const [id, c] of batch)
            this.cache.byWorkspace.set(id, (this.cache.byWorkspace.get(id) ?? 0) + c.requests);
          this.cache.total += [...batch.values()].reduce((a, c) => a + c.requests, 0);
        }
      } catch {
        // Counting is best effort; never fail a request, and put the counts back.
        for (const [id, c] of batch) {
          const p = this.pending.get(id) ?? { requests: 0, rejected: 0 };
          p.requests += c.requests;
          p.rejected += c.rejected;
          this.pending.set(id, p);
        }
      } finally {
        this.flushing = undefined;
      }
    })();
    return this.flushing;
  }

  /** This workspace's requests today, as far as this instance knows. */
  async today(id: string): Promise<number> {
    const snap = await this.snapshot();
    return (snap.byWorkspace.get(id) ?? 0) + (this.pending.get(id)?.requests ?? 0);
  }
}
