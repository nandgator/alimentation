import { rupees } from '@alimentation/core';
import type { Actor } from '../../src/workspace/context.ts';
import type { Fixture } from './fixture.ts';

export const MENU = { 1: 'Veg', 2: 'Veg', 3: 'Non Veg', 4: 'Veg', 5: 'Non Veg' } as const;
export const at = (iso: string) => new Date(iso);

/** The spec's seed (section 10), entered the way people would enter it. */
export async function seedSpec(
  fx: Fixture,
): Promise<{ jovial: Actor; smruti: Actor; admin: Actor; supplier: Actor }> {
  fx.clock.now = at('2026-09-30T06:00:00Z');
  const { svc, admin, supplier } = fx;
  await svc.addRateCard(admin, {
    effectiveFrom: '2026-04-01',
    veg: rupees(150),
    nonVeg: rupees(170),
    extraChapati: rupees(15),
    extraBhakri: rupees(30),
    extrasPerMonth: rupees(40),
    menu: MENU,
  });
  for (const [date, name, confirmed] of [
    ['2026-05-01', 'Maharashtra Day', true],
    ['2026-09-14', 'Holiday', true],
    ['2026-10-02', 'Gandhi Jayanti', true],
    ['2026-10-20', 'Holiday', true],
    ['2026-11-09', 'Holiday', true],
    ['2026-11-10', 'Holiday', true],
    ['2026-11-11', 'Holiday', true],
    ['2026-11-12', 'Tentative', false],
    ['2026-11-13', 'Tentative', false],
    ['2026-12-25', 'Christmas', true],
  ] as const)
    await svc.addHoliday(admin, { name, date, location: 'Mumbai', confirmed });
  const jovial = await fx.addConsumer('Jovial');
  const smruti = await fx.addConsumer('Smruti');
  await svc.addLog(jovial, {
    date: '2026-10-01',
    personId: jovial.personId,
    allConsumers: false,
    change: 'Extra Bhakri',
    qty: 2,
  });
  await svc.addLog(smruti, {
    date: '2026-10-16',
    personId: smruti.personId,
    allConsumers: false,
    change: 'Leave',
    qty: null,
    note: 'WFH',
  });
  fx.clock.now = at('2026-11-15T06:00:00Z');
  return { jovial, smruti, admin, supplier };
}
