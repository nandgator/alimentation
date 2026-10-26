import { describe, expect, it } from 'vitest';
import {
  board,
  isFrozen,
  nextMark,
  nthWorkingDay,
  startingMarks,
  todayIso,
  weeks,
} from './month.ts';

// A fixed "today": Wednesday 10 March 2027. The page itself uses the visitor's own date.
const TODAY = '2027-03-10';

describe('the home page’s sample calendar', () => {
  it('lays a month out in Monday to Friday columns, keeping the real date in every slot', () => {
    const inMonth = (row: string[], month: string) => row.filter((d) => d.startsWith(month)).length;
    const march = weeks('2027-03');
    expect(march.every((row) => row.length === 5)).toBe(true);
    expect(march.map((row) => inMonth(row, '2027-03'))).toEqual([5, 5, 5, 5, 3]);
    expect(march[0]![0]).toBe('2027-03-01');
    // The last row runs on into April, and says so with real dates.
    expect(march.at(-1)).toEqual([
      '2027-03-29',
      '2027-03-30',
      '2027-03-31',
      '2027-04-01',
      '2027-04-02',
    ]);
    // May 2027 starts on a Saturday: no empty first row, and the 31st is a lone Monday.
    const may = weeks('2027-05');
    expect(may[0]![0]).toBe('2027-05-03');
    expect(may.at(-1)).toEqual([
      '2027-05-31',
      '2027-06-01',
      '2027-06-02',
      '2027-06-03',
      '2027-06-04',
    ]);
    // A month that starts mid-week keeps its columns: 1 September 2027 is a Wednesday.
    expect(weeks('2027-09')[0]).toEqual([
      '2027-08-30',
      '2027-08-31',
      '2027-09-01',
      '2027-09-02',
      '2027-09-03',
    ]);
  });

  it('counts working days across weekends, forwards and backwards', () => {
    expect(nthWorkingDay(TODAY, 2)).toBe('2027-03-12');
    expect(nthWorkingDay('2027-03-12', 1)).toBe('2027-03-15');
    expect(nthWorkingDay(TODAY, -3)).toBe('2027-03-05');
    expect(nthWorkingDay('2027-03-15', -1)).toBe('2027-03-12');
  });

  it('freezes every day up to and including today and leaves the rest tentative', () => {
    expect(isFrozen('2027-03-09', TODAY)).toBe(true);
    expect(isFrozen(TODAY, TODAY)).toBe(true);
    expect(isFrozen('2027-03-11', TODAY)).toBe(false);
    expect(todayIso(new Date(2027, 2, 10, 23, 59))).toBe(TODAY);
  });

  it('bills the default meals when nothing is marked: 14 veg at 120, 9 non-veg at 150, 30 of extras', () => {
    const { statement } = board({}, TODAY, '2027-03');
    expect(statement.counts).toMatchObject({ meals: 23, veg: 14, nonVeg: 9, leave: 0 });
    expect(statement.mealsAmount).toBe(303000);
    expect(statement.extrasAmount).toBe(3000);
    expect(statement.liveTotal).toBe(306000);
    expect(statement.basis).toBe('Projected');
    // Frozen so far: the eight working days from 1 to 10 March, 5 veg and 3 non-veg, and the extras.
    expect(statement.actualToDate).toBe(5 * 12000 + 3 * 15000 + 3000);
  });

  it('follows each kind of mark the way the spec says', () => {
    const total = (marks: Parameters<typeof board>[0]) =>
      board(marks, TODAY, '2027-03').statement.liveTotal;
    expect(total({ '2027-03-12': 'leave' })).toBe(306000 - 15000); // a Friday: non-veg, 150
    expect(total({ '2027-03-16': 'switch' })).toBe(306000 + 3000); // a Tuesday: veg 120 becomes non-veg 150
    expect(total({ '2027-03-19': 'chapati' })).toBe(306000 + 2000); // two extra chapatis at 10
  });

  it('starts with history behind today and changes still to come', () => {
    const marks = startingMarks(TODAY);
    expect(marks).toEqual({
      '2027-03-02': 'chapati',
      '2027-03-05': 'leave',
      '2027-03-12': 'leave',
      '2027-03-16': 'switch',
      '2027-03-19': 'chapati',
    });
    const { days, statement } = board(marks, TODAY, '2027-03');
    expect(statement.liveTotal).toBe(306000 - 15000 + 2000 - 15000 + 3000 + 2000);
    // What is frozen counts only the two marks behind today: a leave (-150) and two chapatis (+20).
    expect(statement.actualToDate).toBe(108000 - 15000 + 2000);
    expect(days.get('2027-03-05')!.status).toBe('Leave');
    expect(days.get('2027-03-05')!.basis).toBe('Actual');
    expect(days.get('2027-03-16')!.meal).toBe('Non Veg');
    expect(days.get('2027-03-16')!.basis).toBe('Projected');
  });

  it('can look back at a month that is over (all frozen) and ahead at one that has not begun', () => {
    const past = board(startingMarks('2027-04-10'), '2027-04-10', '2027-03').statement;
    expect(past.basis).toBe('Actual');
    expect(past.actualToDate).toBe(past.liveTotal);
    const next = board(startingMarks(TODAY), TODAY, '2027-04').statement;
    expect(next.basis).toBe('Projected');
    expect(next.actualToDate).toBe(0);
    expect(next.counts.meals).toBe(22); // April 2027 has 22 working days
    expect(next.liveTotal).toBe(13 * 12000 + 9 * 15000 + 3000); // 13 veg, 9 non-veg, 30 of extras
    // February 2027 is over: 12 veg and 8 non-veg days, and the extras.
    const feb = board(startingMarks(TODAY), TODAY, '2027-02').statement;
    expect(feb.basis).toBe('Actual');
    expect(feb.liveTotal).toBe(12 * 12000 + 8 * 15000 + 3000);
  });

  it('steps a day through meal, leave, switch, chapati and back', () => {
    let m = nextMark(undefined);
    const seen = [m];
    for (let i = 0; i < 4; i++) seen.push((m = nextMark(m)));
    expect(seen).toEqual(['leave', 'switch', 'chapati', 'meal', 'leave']);
  });
});
