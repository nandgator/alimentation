import { describe, expect, it } from 'vitest';
import { board, nextMark, STARTING_MARKS, weeks } from './month.ts';

describe('the home page’s sample month', () => {
  it('has the working days of March 2027, Monday to Friday, in weeks', () => {
    const w = weeks();
    expect(w.map((x) => x.length)).toEqual([5, 5, 5, 5, 3]);
    expect(w[0]![0]).toBe('2027-03-01');
    expect(w.at(-1)!.at(-1)).toBe('2027-03-31');
  });

  it('bills the default meals when nothing is marked: 14 veg at 120, 9 non-veg at 150, 30 of extras', () => {
    const { statement } = board({});
    expect(statement.counts).toMatchObject({ meals: 23, veg: 14, nonVeg: 9, leave: 0 });
    expect(statement.mealsAmount).toBe(303000);
    expect(statement.extrasAmount).toBe(3000);
    expect(statement.liveTotal).toBe(306000);
  });

  it('follows each kind of mark the way the spec says', () => {
    // A leave removes that day's meal; a switch changes its price; extra chapatis add 10 each.
    const leave = board({ '2027-03-10': 'leave' }).statement; // a Wednesday: non-veg, 150
    expect(leave.liveTotal).toBe(306000 - 15000);
    const sw = board({ '2027-03-18': 'switch' }).statement; // a Thursday: veg 120 becomes non-veg 150
    expect(sw.liveTotal).toBe(306000 + 3000);
    const bread = board({ '2027-03-04': 'chapati' }).statement; // two extra chapatis
    expect(bread.liveTotal).toBe(306000 + 2000);
    expect(bread.counts.extraChapati).toBe(2);
  });

  it('starts with one of each, and every tile can be read back from the engine', () => {
    const { days, statement } = board(STARTING_MARKS);
    expect(statement.liveTotal).toBe(306000 - 15000 + 3000 + 2000);
    expect(days.get('2027-03-10')!.status).toBe('Leave');
    expect(days.get('2027-03-18')!.meal).toBe('Non Veg');
    expect(days.get('2027-03-04')!.extraChapati).toBe(2);
  });

  it('steps a day through meal, leave, switch, chapati and back', () => {
    let m = nextMark(undefined);
    const seen = [m];
    for (let i = 0; i < 4; i++) seen.push((m = nextMark(m)));
    expect(seen).toEqual(['leave', 'switch', 'chapati', 'meal', 'leave']);
  });
});
