import { z } from 'zod';
import { addDays, monthEnd, monthOf, monthStart, type IsoDate, type Month } from './dates.ts';

/**
 * The rules a workspace has chosen. A policy is a document, versioned and
 * effective-dated like a rate card: a new version is appended, old ones are never
 * edited, and a month is evaluated under the version in force on its first day.
 * `.strict()` everywhere so a rule this build does not know about is refused, not
 * silently dropped.
 */

const AfterClose = z.enum(['flag', 'block']);

export const PolicySchema = z
  .object({
    version: z.literal(1),
    /** 0 is Sunday. Each of these needs a menu entry on the rate card. */
    workingDays: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .refine((a) => new Set(a).size === a.length, 'workingDays must be distinct'),
    holidays: z.object({ count: z.enum(['confirmed', 'all']) }).strict(),
    /** Null means no flat monthly extras. The amount comes from the rate card. */
    extras: z
      .object({ minMeals: z.number().int().min(1).max(31) })
      .strict()
      .nullable(),
    /** Share of the day's meal price charged on a leave day, in basis points. */
    leave: z.object({ chargeBps: z.number().int().min(0).max(10000) }).strict(),
    monthClose: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('off') }).strict(),
      z.object({ mode: z.literal('manual'), afterClose: AfterClose }).strict(),
      z
        .object({
          mode: z.literal('auto'),
          /** The month closes this many days after its last day. */
          afterDays: z.number().int().min(0).max(60),
          afterClose: AfterClose,
        })
        .strict(),
    ]),
    /** Consumers must log an exception this many days before, by this local time. */
    exceptionCutoff: z
      .object({
        daysBefore: z.number().int().min(0).max(7),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      })
      .strict()
      .nullable(),
    payments: z.enum(['claim_confirm', 'direct']),
    rateCards: z.object({ backdating: z.enum(['none', 'current_month', 'unrestricted']) }).strict(),
  })
  .strict();

export type Policy = z.infer<typeof PolicySchema>;

export const DEFAULT_POLICY: Policy = {
  version: 1,
  workingDays: [1, 2, 3, 4, 5],
  holidays: { count: 'confirmed' },
  extras: { minMeals: 1 },
  leave: { chargeBps: 0 },
  monthClose: { mode: 'manual', afterClose: 'flag' },
  exceptionCutoff: null,
  payments: 'claim_confirm',
  rateCards: { backdating: 'current_month' },
};

export interface PolicyVersion {
  effectiveFrom: IsoDate;
  doc: Policy;
}

/** The version in force on `date`: the latest whose `effectiveFrom` is not after it. */
export function policyOn(versions: readonly PolicyVersion[], date: IsoDate): Policy {
  let best: PolicyVersion | undefined;
  for (const v of versions) {
    // Stryker disable next-line EqualityOperator: two versions never share a date
    if (v.effectiveFrom <= date && (!best || v.effectiveFrom > best.effectiveFrom)) best = v;
  }
  return best ? best.doc : DEFAULT_POLICY;
}

/** The policy that governs a whole month: the one in force on its first day. */
export function policyForMonth(versions: readonly PolicyVersion[], month: Month): Policy {
  return policyOn(versions, monthStart(month));
}

/**
 * Under an `auto` rule, the last date on which a month is still open: its final
 * day plus `afterDays`. The month counts as closed from the day after. Null when
 * the rule is not automatic.
 */
export function autoCloseDate(policy: Policy, month: Month): IsoDate | null {
  if (policy.monthClose.mode !== 'auto') return null;
  return addDays(monthEnd(month), policy.monthClose.afterDays);
}

/**
 * Whether a rate card may start on `effectiveFrom`. A card that starts inside a
 * month that is already closed would reprice it, so that is refused unless the
 * workspace allows unrestricted back-dating (and the "changed after close" flag
 * then shows the difference).
 */
export function rateCardStartAllowed(
  policy: Policy,
  effectiveFrom: IsoDate,
  today: IsoDate,
  lastClosedMonth: Month | null,
): boolean {
  switch (policy.rateCards.backdating) {
    case 'unrestricted':
      return true;
    case 'current_month':
      return (
        monthOf(effectiveFrom) >= monthOf(today) &&
        (!lastClosedMonth || monthOf(effectiveFrom) > lastClosedMonth)
      );
    case 'none':
      return effectiveFrom >= today;
  }
}
