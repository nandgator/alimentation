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

  it('keeps no two wisps to the same time, or to a multiple of another’s, so the whole never visibly repeats', () => {
    const clash = (xs: number[]) =>
      xs.flatMap((a, i) =>
        xs.slice(i + 1).filter((b) => Number.isInteger(a / b) || Number.isInteger(b / a)),
      );
    expect(clash(WISPS.map((w) => w.life))).toEqual([]);
    expect(clash(WISPS.map((w) => w.swing))).toEqual([]);
    // And each is already part-way through its life when the page opens.
    expect(WISPS.every((w) => w.at < 0)).toBe(true);
  });

  it('rises from inside the lid and has thinned away before it reaches anything above', () => {
    for (const v of [CARRIER_VENT, POT_VENT]) {
      expect(v.gone).toBeLessThan(v.lid);
      for (const w of v.wisps) {
        // The line is longer than the air it fades in, so the end of it is never seen at rest.
        expect(v.lid - w.h).toBeLessThan(v.gone + 30);
        expect(w.peak).toBeGreaterThan(0);
        expect(w.peak).toBeLessThanOrEqual(0.7);
      }
    }
  });
});
