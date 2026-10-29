import { describe, expect, it } from 'vitest';
import { CARRIER_VENT, POT_VENT, wispPath } from './steam.tsx';

const WISPS = [...CARRIER_VENT.wisps, ...POT_VENT.wisps];

describe('the steam over the lids', () => {
  it('draws each wisp as one smooth line from the vent straight up its length', () => {
    for (const w of WISPS) {
      const d = wispPath(w);
      expect(d.startsWith('M0 0L'), d).toBe(true);
      // Only moves, lines and curves: no corner is ever drawn by hand.
      expect(d.replace(/[MLQ\d\s.,-]/g, ''), d).toBe('');
      expect(d).not.toMatch(/NaN|Infinity/);
      const end = /L(-?[\d.]+) (-?[\d.]+)$/.exec(d)!;
      expect(Number(end[2])).toBeCloseTo(-w.h, 0);
    }
  });

  it('gives every wisp a shape of its own, the same each time', () => {
    const shapes = WISPS.map((w) => wispPath(w));
    expect(new Set(shapes).size).toBe(WISPS.length);
    expect(WISPS.map((w) => wispPath(w))).toEqual(shapes);
  });

  it('keeps a lid steaming all the time: one pace for its wisps, started at spread points of it', () => {
    for (const v of [CARRIER_VENT, POT_VENT]) {
      // Wisps on different paces drift into step and the lid goes quiet, then puffs; on one they stay where they were put.
      expect(v.life).toBeGreaterThan(0);
      const starts = v.wisps.map((w) => w.start).sort((a, b) => a - b);
      expect(starts.every((x) => x >= 0 && x < 1)).toBe(true);
      // Round the circle of a trip, the gaps are never wide, and no two wisps start together.
      const gaps = starts.map((x, i) => (starts[(i + 1) % starts.length]! - x + 1) % 1 || 1);
      for (const g of gaps) {
        expect(g).toBeGreaterThan(0.08);
        expect(g).toBeLessThanOrEqual(0.5);
      }
    }
    // The two lids are on paces of their own, so they do not pulse together.
    expect(CARRIER_VENT.life).not.toBe(POT_VENT.life);
  });

  it('gives no wisp the same sway as another, or a multiple of it, so the whole never visibly repeats', () => {
    const clash = (xs: number[]) =>
      xs.flatMap((a, i) =>
        xs.slice(i + 1).filter((b) => Number.isInteger(a / b) || Number.isInteger(b / a)),
      );
    expect(clash(WISPS.map((w) => w.swing))).toEqual([]);
  });

  it('rises from inside the lid and has thinned away before it reaches anything above', () => {
    for (const v of [CARRIER_VENT, POT_VENT]) {
      expect(v.gone).toBeLessThan(v.lid);
      for (const w of v.wisps) {
        // The line is longer than the air it fades in, so the end of it is never seen at rest.
        expect(v.lid - w.h).toBeLessThan(v.gone + 30);
        expect(w.peak).toBeGreaterThan(0);
        expect(w.peak).toBeLessThanOrEqual(0.9);
      }
    }
  });
});
