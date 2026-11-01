import type { Statement } from './engine.ts';
import type { Paise } from './money.ts';

/**
 * A kitchen in four numbers, for a page that lists several of them. It is worked out from statements the
 * reader was already allowed to see, so it can say nothing the kitchen's own pages would not.
 */
export interface Headline {
  /** What this month's bill comes to, over the people the statements are about. */
  billed: Paise;
  /** What those people have paid towards this month. */
  paid: Paise;
  /**
   * What is owed to the kitchen: for each person this month's balance and every earlier month's together, a
   * person who is ahead counting as nothing, so that one person's credit does not hide another's debt.
   */
  owed: Paise;
  /** Claims of payment waiting to be confirmed. */
  toConfirm: number;
  /** How many people the statements are about. */
  people: number;
}

type Figures = Pick<Statement, 'personId' | 'billed' | 'paid' | 'balance' | 'earlierUnpaid'>;

export function headline(statements: readonly Figures[], toConfirm: number): Headline {
  let billed = 0;
  let paid = 0;
  let owed = 0;
  for (const s of statements) {
    billed += s.billed;
    paid += s.paid;
    owed += Math.max(0, s.balance + s.earlierUnpaid);
  }
  return {
    billed,
    paid,
    owed,
    toConfirm,
    people: new Set(statements.map((s) => s.personId)).size,
  };
}

/** Headlines added up across kitchens that keep their books in the same currency. */
export function addHeadlines(parts: readonly Headline[]): Headline {
  return parts.reduce<Headline>(
    (a, h) => ({
      billed: a.billed + h.billed,
      paid: a.paid + h.paid,
      owed: a.owed + h.owed,
      toConfirm: a.toConfirm + h.toConfirm,
      people: a.people + h.people,
    }),
    { billed: 0, paid: 0, owed: 0, toConfirm: 0, people: 0 },
  );
}
