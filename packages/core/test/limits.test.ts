import { describe, expect, it } from 'vitest';
import {
  canAdmit,
  capacityPlan,
  FREE_LIMITS,
  GRACE_DAYS,
  meter,
  REFERENCE_CAPACITY,
  type Usage,
} from '../src/index.ts';

const usage = (over: Partial<Usage> = {}): Usage => ({
  requestsLast24h: 0,
  people: 0,
  rows: 0,
  bytes: 0,
  ...over,
});
const L = FREE_LIMITS;

describe('the usage meter', () => {
  it('is OK below 70 percent, WATCH from 70, ASK from 90, OVER at 100', () => {
    const at = (r: number) =>
      meter(usage({ rows: Math.round(L.rows * r) }), L, null, '2026-10-24').state;
    expect(at(0)).toBe('OK');
    expect(at(0.69)).toBe('OK');
    expect(at(0.7)).toBe('WATCH');
    expect(at(0.89)).toBe('WATCH');
    expect(at(0.9)).toBe('ASK');
    expect(at(0.99)).toBe('ASK');
    expect(at(1)).toBe('OVER');
    expect(at(3)).toBe('OVER');
  });

  it('reports the measure that is closest to its limit', () => {
    const m = meter(usage({ people: 23, rows: 100, requestsLast24h: 10 }), L, null, '2026-10-24');
    expect(m.worst).toBe('people');
    expect(m.ratio).toBeCloseTo(23 / L.people);
    expect(m.state).toBe('ASK');
  });

  it('gives a 14 day grace from the first day over, keeping the first date', () => {
    const first = meter(usage({ rows: L.rows }), L, null, '2026-10-24');
    expect(first).toMatchObject({
      state: 'OVER',
      overSince: '2026-10-24',
      graceEndsOn: '2026-11-07',
      writesAllowed: true,
    });
    expect(GRACE_DAYS).toBe(14);
    const later = meter(usage({ rows: L.rows + 5 }), L, first.overSince, '2026-11-07');
    expect(later).toMatchObject({ overSince: '2026-10-24', writesAllowed: true });
    const after = meter(usage({ rows: L.rows + 5 }), L, first.overSince, '2026-11-08');
    expect(after).toMatchObject({ overSince: '2026-10-24', writesAllowed: false });
  });

  it('forgets being over the moment usage falls back, and restarts the grace if it returns', () => {
    const back = meter(usage({ rows: 10 }), L, '2026-10-24', '2026-11-20');
    expect(back).toMatchObject({
      state: 'OK',
      overSince: null,
      graceEndsOn: null,
      writesAllowed: true,
    });
    const again = meter(usage({ rows: L.rows }), L, back.overSince, '2026-11-21');
    expect(again.overSince).toBe('2026-11-21');
  });

  it('treats a zero limit as over as soon as anything is used', () => {
    expect(meter(usage({ people: 1 }), { ...L, people: 0 }, null, '2026-10-24').state).toBe('OVER');
    expect(meter(usage(), { ...L, people: 0 }, null, '2026-10-24').state).toBe('OK');
  });
});

describe('capacity of the free tiers', () => {
  it('is the smaller of what projects and daily requests allow', () => {
    const plan = capacityPlan(REFERENCE_CAPACITY);
    expect(plan).toEqual({ byProjects: 98, byRequests: 80, capacity: 80, binding: 'requests' });
  });

  it('flips to projects when workspaces are given less traffic', () => {
    const plan = capacityPlan({ ...REFERENCE_CAPACITY, perWorkspaceRequestsPerDay: 500 });
    expect(plan).toMatchObject({
      byProjects: 98,
      byRequests: 160,
      capacity: 98,
      binding: 'projects',
    });
  });

  it('admits until full and not one more', () => {
    const plan = capacityPlan(REFERENCE_CAPACITY);
    expect(canAdmit(plan, 79)).toBe(true);
    expect(canAdmit(plan, 80)).toBe(false);
  });

  it('never goes negative', () => {
    expect(capacityPlan({ ...REFERENCE_CAPACITY, reservedProjects: 500 }).capacity).toBe(0);
  });
});
