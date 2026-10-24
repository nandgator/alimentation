import { describe, expect, it } from 'vitest';
import { scheduleHousekeeping, type Timers } from '../src/lifecycle/housekeeping.ts';
import type { PlatformDeps } from '../src/platform/workspaces.ts';

/** Timers that run only when the test says so. */
function manualTimers() {
  const once: (() => void)[] = [];
  const repeat: (() => void)[] = [];
  const cancelled: string[] = [];
  const timers: Timers = {
    after: (_ms, fn) => (once.push(fn), () => void cancelled.push('first')),
    every: (_ms, fn) => (repeat.push(fn), () => void cancelled.push('every')),
  };
  return { timers, once, repeat, cancelled };
}

const settle = () => new Promise((r) => setTimeout(r, 5));

// A control plane with nothing to do, so each run is quick and countable.
const idle = (calls: { n: number; fail?: boolean }) =>
  ({
    now: () => new Date('2026-10-24T06:00:00Z'),
    control: {
      wiping: async () => {
        calls.n++;
        if (calls.fail) throw new Error('control database unreachable');
        return [];
      },
      wipedButPresent: async () => [],
      movedBefore: async () => [],
      retiredDue: async () => [],
      stuckMoving: async () => [],
      pruneUsage: async () => 0,
      pruneInvites: async () => 0,
    },
  }) as unknown as PlatformDeps;

describe('[P4] the slow work of leaving gets done on a server that stays up', () => {
  it('runs soon after start, then regularly, and stops when told to', async () => {
    const t = manualTimers();
    const calls = { n: 0 };
    const stop = scheduleHousekeeping(idle(calls), { timers: t.timers });
    expect(calls.n).toBe(0);
    t.once[0]!();
    await settle();
    expect(calls.n).toBe(1);
    t.repeat[0]!();
    await settle();
    expect(calls.n).toBe(2);
    stop();
    expect(t.cancelled.sort()).toEqual(['every', 'first']);
  });

  it('does not start a run while one is still going', async () => {
    const t = manualTimers();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started = 0;
    const slow = idle({ n: 0 });
    (slow.control as unknown as { wiping: () => Promise<never[]> }).wiping = async () => {
      started++;
      await gate;
      return [];
    };
    scheduleHousekeeping(slow, { timers: t.timers });
    t.once[0]!();
    t.repeat[0]!();
    t.repeat[0]!();
    await settle();
    expect(started).toBe(1);
    release();
    await settle();
    t.repeat[0]!();
    await settle();
    expect(started).toBe(2);
  });

  it('keeps going after a run fails, and says what failed', async () => {
    const t = manualTimers();
    const calls = { n: 0, fail: false };
    const reports: { errors: string[] }[] = [];
    const errors: unknown[] = [];
    scheduleHousekeeping(idle(calls), {
      timers: t.timers,
      onReport: (r) => reports.push(r),
      onError: (e) => errors.push(e),
    });
    t.once[0]!();
    await settle();
    calls.fail = true;
    t.repeat[0]!();
    await settle();
    t.repeat[0]!();
    await settle();
    expect(calls.n).toBe(3);
    // A step that fails is reported inside the report, and the other steps still ran.
    expect(reports).toHaveLength(3);
    expect(reports[0]!.errors).toEqual([]);
    expect(reports[1]!.errors[0]).toMatch(/list finish wipe: control database unreachable/);
    expect(errors).toEqual([]);
  });
});
