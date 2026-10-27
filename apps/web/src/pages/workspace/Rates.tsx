import { useState } from 'react';
import {
  DEFAULT_POLICY,
  dayName,
  type Policy,
  type RateCard,
  type Weekday,
} from '@alimentation/core';
import { getJson, postJson } from '../../api.ts';
import {
  Dialog,
  Field,
  Form,
  PageHead,
  Problem,
  SectionHead,
  Spinner,
  toast,
  useAction,
  useLoad,
} from '../../components/ui.tsx';
import { date, money, rupeesText, toPaise } from '../../format.ts';
import { useWorkspace } from './context.tsx';

const WEEK: Weekday[] = [1, 2, 3, 4, 5, 6, 0];
type MenuChoice = '' | 'Veg' | 'Non Veg';

function CardForm({ last, onDone }: { last: RateCard | null; onDone: () => void }) {
  const ws = useWorkspace();
  const [from, setFrom] = useState(ws.boot.today);
  const [v, setV] = useState({
    veg: last ? rupeesText(last.veg) : '',
    nonVeg: last ? rupeesText(last.nonVeg) : '',
    extraChapati: last ? rupeesText(last.extraChapati) : '',
    extraBhakri: last ? rupeesText(last.extraBhakri) : '',
    extrasPerMonth: last ? rupeesText(last.extrasPerMonth) : '',
  });
  const [menu, setMenu] = useState<Record<number, MenuChoice>>(
    Object.fromEntries(WEEK.map((d) => [d, (last?.menu[d] as MenuChoice | undefined) ?? ''])),
  );
  const [note, setNote] = useState('');
  const act = useAction();
  const keys = Object.keys(v) as (keyof typeof v)[];
  const label: Record<keyof typeof v, string> = {
    veg: 'Veg meal',
    nonVeg: 'Non-veg meal',
    extraChapati: 'Extra chapati',
    extraBhakri: 'Extra bhakri',
    extrasPerMonth: 'Extras charged monthly',
  };
  return (
    <Form
      error={act.error}
      onSubmit={() =>
        act.run(async () => {
          const prices = Object.fromEntries(
            keys.map((k) => {
              const p = toPaise(v[k]);
              if (p === null) throw new Error(`${label[k]}: enter an amount in rupees.`);
              return [k, p];
            }),
          );
          const body = {
            effectiveFrom: from,
            ...prices,
            menu: Object.fromEntries(Object.entries(menu).filter(([, m]) => m)),
            note: note.trim() || null,
          };
          await postJson(`${ws.api}/rate-cards`, body);
          toast('Rate card added.');
          onDone();
          ws.reload();
        })
      }
    >
      <p className="muted small">
        Rates are never changed after the fact: a new card applies from its date onwards.
      </p>
      <Field label="Applies from" id="rfrom">
        <input
          id="rfrom"
          type="date"
          required
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </Field>
      <div className="pair">
        {keys.map((k) => (
          <Field key={k} label={`${label[k]} (₹)`} id={`r-${k}`}>
            <input
              id={`r-${k}`}
              inputMode="decimal"
              required
              value={v[k]}
              onChange={(e) => setV({ ...v, [k]: e.target.value })}
            />
          </Field>
        ))}
      </div>
      <div className="field">
        <span className="label">Menu</span>
        <div className="pair">
          {WEEK.map((d) => (
            <label key={d} className="row nowrap" style={{ ['--gap' as string]: 'var(--space-2)' }}>
              <span className="day-label">{dayName(d)}</span>
              <select
                aria-label={`Menu on ${dayName(d)}`}
                value={menu[d]}
                onChange={(e) => setMenu({ ...menu, [d]: e.target.value as MenuChoice })}
              >
                <option value="">None</option>
                <option>Veg</option>
                <option>Non Veg</option>
              </select>
            </label>
          ))}
        </div>
      </div>
      <Field label="Note (optional)" id="rnote">
        <input id="rnote" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div>
        <button className="btn" disabled={act.busy}>
          Add rate card
        </button>
      </div>
    </Form>
  );
}

function PolicyForm({ current, onDone }: { current: Policy; onDone: () => void }) {
  const ws = useWorkspace();
  const [p, setP] = useState<Policy>(current);
  const [from, setFrom] = useState(ws.boot.today);
  const act = useAction();
  const days = new Set(p.workingDays);
  const close = p.monthClose;
  return (
    <Form
      error={act.error}
      onSubmit={() =>
        act.run(async () => {
          await postJson(`${ws.api}/policies`, { effectiveFrom: from, doc: p });
          toast('Rules updated.');
          onDone();
          ws.reload();
        })
      }
    >
      <p className="muted small">
        These rules apply to months starting on or after the date below. Earlier months keep the
        rules they were billed under.
      </p>
      <Field label="Applies from" id="pfrom2">
        <input
          id="pfrom2"
          type="date"
          required
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </Field>
      <div className="field">
        <span className="label">Meals are served on</span>
        <div className="row">
          {WEEK.map((d) => (
            <label key={d} className="row" style={{ ['--gap' as string]: 'var(--space-1)' }}>
              <input
                type="checkbox"
                checked={days.has(d)}
                onChange={(e) =>
                  setP({
                    ...p,
                    workingDays: e.target.checked
                      ? [...p.workingDays, d].sort()
                      : p.workingDays.filter((x) => x !== d),
                  })
                }
              />
              {dayName(d)}
            </label>
          ))}
        </div>
      </div>
      <div className="pair">
        <Field label="Holidays that cancel a meal" id="pol-h">
          <select
            id="pol-h"
            value={p.holidays.count}
            onChange={(e) =>
              setP({ ...p, holidays: { count: e.target.value as 'confirmed' | 'all' } })
            }
          >
            <option value="confirmed">Only confirmed holidays</option>
            <option value="all">All listed holidays</option>
          </select>
        </Field>
        <Field label="Charge on a leave day (%)" id="pol-l" hint="Share of the day’s meal price.">
          <input
            id="pol-l"
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={p.leave.chargeBps / 100}
            onChange={(e) =>
              setP({ ...p, leave: { chargeBps: Math.round(Number(e.target.value) * 100) } })
            }
          />
        </Field>
        <Field
          label="Monthly extras apply from"
          id="pol-e"
          hint="Meals needed in the month; none means no monthly extras."
        >
          <input
            id="pol-e"
            type="number"
            min={0}
            max={31}
            value={p.extras?.minMeals ?? 0}
            onChange={(e) =>
              setP({
                ...p,
                extras: Number(e.target.value) > 0 ? { minMeals: Number(e.target.value) } : null,
              })
            }
          />
        </Field>
        <Field label="Payments" id="pol-p">
          <select
            id="pol-p"
            value={p.payments}
            onChange={(e) => setP({ ...p, payments: e.target.value as Policy['payments'] })}
          >
            <option value="claim_confirm">Member claims, supplier confirms</option>
            <option value="direct">Recorded directly</option>
          </select>
        </Field>
      </div>
      <div className="pair">
        <Field
          label="Month close"
          id="pol-c"
          hint="The window for everyone to catch up. After it, meals and leave freeze; payments carry on."
        >
          <select
            id="pol-c"
            value={close.mode}
            onChange={(e) =>
              setP({
                ...p,
                monthClose:
                  e.target.value === 'off'
                    ? { mode: 'off' }
                    : e.target.value === 'manual'
                      ? { mode: 'manual', afterClose: 'flag' }
                      : { mode: 'auto', afterDays: 5, afterClose: 'flag' },
              })
            }
          >
            <option value="off">Never closed</option>
            <option value="manual">Closed by the admin</option>
            <option value="auto">Closes by itself</option>
          </select>
        </Field>
        {close.mode === 'auto' ? (
          <Field label="Days after month end" id="pol-cd">
            <input
              id="pol-cd"
              type="number"
              min={0}
              max={60}
              value={close.afterDays}
              onChange={(e) =>
                setP({ ...p, monthClose: { ...close, afterDays: Number(e.target.value) } })
              }
            />
          </Field>
        ) : null}
        {close.mode !== 'off' ? (
          <Field label="Entries after close" id="pol-ca">
            <select
              id="pol-ca"
              value={close.afterClose}
              onChange={(e) =>
                setP({
                  ...p,
                  monthClose: { ...close, afterClose: e.target.value as 'flag' | 'block' },
                })
              }
            >
              <option value="flag">Allowed, and flagged</option>
              <option value="block">Not allowed</option>
            </select>
          </Field>
        ) : null}
        <Field label="Rate cards may start" id="pol-b">
          <select
            id="pol-b"
            value={p.rateCards.backdating}
            onChange={(e) =>
              setP({
                ...p,
                rateCards: { backdating: e.target.value as Policy['rateCards']['backdating'] },
              })
            }
          >
            <option value="none">Only from today</option>
            <option value="current_month">From the start of this month</option>
            <option value="unrestricted">Any date</option>
          </select>
        </Field>
      </div>
      <div className="pair">
        <Field
          label="Exceptions due, days before"
          id="pol-x"
          hint="Empty means any time. Anything added after its day is always marked late."
        >
          <input
            id="pol-x"
            type="number"
            min={0}
            max={7}
            value={p.exceptionCutoff?.daysBefore ?? ''}
            onChange={(e) =>
              setP({
                ...p,
                exceptionCutoff:
                  e.target.value === ''
                    ? null
                    : {
                        daysBefore: Number(e.target.value),
                        time: p.exceptionCutoff?.time ?? '20:00',
                      },
              })
            }
          />
        </Field>
        {p.exceptionCutoff ? (
          <Field label="By this time" id="pol-xt">
            <input
              id="pol-xt"
              type="time"
              value={p.exceptionCutoff.time}
              onChange={(e) =>
                setP({ ...p, exceptionCutoff: { ...p.exceptionCutoff!, time: e.target.value } })
              }
            />
          </Field>
        ) : null}
      </div>
      <div>
        <button className="btn" disabled={act.busy || p.workingDays.length === 0}>
          Save rules
        </button>
      </div>
    </Form>
  );
}

export function Rates() {
  const ws = useWorkspace();
  const cards = useLoad(() => getJson<RateCard[]>(`${ws.api}/rate-cards`), [ws.api]);
  const pols = useLoad(
    () => getJson<{ effectiveFrom: string; doc: Policy }[]>(`${ws.api}/policies`),
    [ws.api],
  );
  const [dlg, setDlg] = useState<'card' | 'policy' | null>(null);
  const list = [...(cards.data ?? [])].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  const current =
    pols.data && pols.data.length
      ? pols.data[pols.data.length - 1]!.doc
      : (ws.boot.policy ?? DEFAULT_POLICY);
  return (
    <div className="stack" style={{ ['--gap' as string]: '24px' }}>
      <PageHead
        title="Rates and rules"
        lead="What a meal costs, and the rules each bill follows."
      />
      <Problem error={cards.error ?? pols.error} />
      <section className="stack" aria-label="Rate cards">
        <SectionHead
          title="Rate cards"
          actions={
            <button className="btn small" disabled={!ws.writable} onClick={() => setDlg('card')}>
              New rate card
            </button>
          }
        />
        {cards.loading && !cards.data ? <Spinner /> : null}
        {list.length > 0 ? (
          <div
            className="tablewrap"
            tabIndex={0}
            role="region"
            aria-label="Table; scrolls sideways when it is wider than the screen"
          >
            <table>
              <thead>
                <tr>
                  <th>From</th>
                  <th className="r">Veg</th>
                  <th className="r">Non veg</th>
                  <th className="r">Chapati</th>
                  <th className="r">Bhakri</th>
                  <th className="r">Extras / month</th>
                  <th>Menu</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td>{date(c.effectiveFrom)}</td>
                    <td className="r">{money(c.veg)}</td>
                    <td className="r">{money(c.nonVeg)}</td>
                    <td className="r">{money(c.extraChapati)}</td>
                    <td className="r">{money(c.extraBhakri)}</td>
                    <td className="r">{money(c.extrasPerMonth)}</td>
                    <td>
                      {WEEK.filter((d) => c.menu[d])
                        .map((d) => `${dayName(d)} ${c.menu[d] === 'Veg' ? 'V' : 'N'}`)
                        .join(' · ') || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="stack" aria-label="Rules">
        <SectionHead
          title="Rules for this kitchen"
          actions={
            <button className="btn small" disabled={!ws.writable} onClick={() => setDlg('policy')}>
              Change rules
            </button>
          }
        />
        <div className="card">
          <ul className="stack plain-list" style={{ ['--gap' as string]: 'var(--space-2)' }}>
            <li>Meals on {current.workingDays.map((d) => dayName(d as Weekday)).join(', ')}.</li>
            <li>
              {current.holidays.count === 'confirmed'
                ? 'Only confirmed holidays cancel a meal.'
                : 'Every listed holiday cancels a meal.'}
            </li>
            <li>A leave day is charged {current.leave.chargeBps / 100}% of the meal.</li>
            <li>
              {current.extras
                ? `Monthly extras apply from ${current.extras.minMeals} meal${current.extras.minMeals === 1 ? '' : 's'}.`
                : 'No monthly extras.'}
            </li>
            <li>
              {current.monthClose.mode === 'off'
                ? 'Months are never closed.'
                : current.monthClose.mode === 'manual'
                  ? 'The admin closes each month.'
                  : `Months close by themselves ${current.monthClose.afterDays} days after they end.`}
              {current.monthClose.mode !== 'off'
                ? current.monthClose.afterClose === 'flag'
                  ? ' Later changes are flagged.'
                  : ' Later changes are not allowed.'
                : ''}
            </li>
            <li>
              {current.payments === 'claim_confirm'
                ? 'Members claim a payment and the supplier confirms it.'
                : 'Payments are recorded directly.'}
            </li>
            <li>
              {current.exceptionCutoff
                ? `Exceptions are due ${current.exceptionCutoff.daysBefore} day(s) before, by ${current.exceptionCutoff.time}. After that, the admin can still add one for you, marked late.`
                : 'Exceptions can be added at any time. One added after its day is marked late, so everyone can see.'}
            </li>
          </ul>
        </div>
      </section>

      <Dialog open={dlg === 'card'} onClose={() => setDlg(null)} title="New rate card">
        {dlg === 'card' ? (
          <CardForm
            last={list[0] ?? null}
            onDone={() => {
              setDlg(null);
              cards.reload();
            }}
          />
        ) : null}
      </Dialog>
      <Dialog open={dlg === 'policy'} onClose={() => setDlg(null)} title="Change the rules">
        {dlg === 'policy' ? (
          <PolicyForm
            current={current}
            onDone={() => {
              setDlg(null);
              pols.reload();
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
