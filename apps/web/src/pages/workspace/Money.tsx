import { useState } from 'react';
import {
  SETTLEMENT_TYPES,
  type SettlementDto,
  type SettlementType,
  type StatementDto,
} from '@alimentation/core';
import { api, getJson, postJson } from '../../api.ts';
import {
  Chip,
  Dialog,
  Field,
  Form,
  MonthPicker,
  PageHead,
  Problem,
  Spinner,
  toast,
  useAction,
  useLoad,
} from '../../components/ui.tsx';
import { date, money, month as monthLabel, toPaise } from '../../format.ts';
import { useWorkspace } from './context.tsx';

export function Holidays() {
  const ws = useWorkspace();
  const [name, setName] = useState('');
  const [day, setDay] = useState(ws.boot.today);
  const [confirmed, setConfirmed] = useState(true);
  const act = useAction();
  const list = [...ws.boot.holidays].sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <div className="stack" style={{ ['--gap' as string]: '20px' }}>
      <PageHead title="Holidays" />
      <section className="card stack">
        <Form
          error={act.error}
          onSubmit={() =>
            act.run(async () => {
              await postJson(`${ws.api}/holidays`, { name, date: day, confirmed });
              setName('');
              toast('Holiday added.');
              ws.reload();
            })
          }
        >
          <div className="pair">
            <Field label="Name" id="hname">
              <input
                id="hname"
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Date" id="hdate">
              <input
                id="hdate"
                type="date"
                required
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </Field>
          </div>
          <label className="row" style={{ ['--gap' as string]: 'var(--space-3)' }}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Confirmed (a meal is not served and not billed)
          </label>
          <div>
            <button className="btn" disabled={act.busy || !ws.writable}>
              Add
            </button>
          </div>
        </Form>
      </section>
      {list.length === 0 ? <p className="muted">No holidays yet.</p> : null}
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
                <th>Date</th>
                <th>Name</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((h) => (
                <tr key={h.id}>
                  <td>{date(h.date)}</td>
                  <td>{h.name}</td>
                  <td>
                    <Chip tone={h.confirmed ? 'good' : 'warn'}>
                      {h.confirmed ? 'Confirmed' : 'Tentative'}
                    </Chip>
                  </td>
                  <td>
                    <div className="row" style={{ ['--gap' as string]: 'var(--space-2)' }}>
                      <button
                        className="btn ghost small"
                        disabled={!ws.writable}
                        onClick={() =>
                          void api
                            .patch(`${ws.api}/holidays/${h.id}`, { confirmed: !h.confirmed })
                            .then(ws.reload, (e: Error) => toast(e.message, 'bad'))
                        }
                      >
                        {h.confirmed ? 'Make tentative' : 'Confirm'}
                      </button>
                      <button
                        className="btn ghost small"
                        disabled={!ws.writable}
                        onClick={() =>
                          void api
                            .del(`${ws.api}/holidays/${h.id}`)
                            .then(ws.reload, (e: Error) => toast(e.message, 'bad'))
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function Settlements() {
  const ws = useWorkspace();
  const consumers = ws.boot.people.filter((p) => p.role === 'consumer');
  const list = useLoad(() => getJson<SettlementDto[]>(`${ws.api}/settlements`), [ws.api]);
  const [who, setWho] = useState(consumers[0]?.id ?? '');
  const [forMonth, setForMonth] = useState(ws.boot.currentMonth);
  const [type, setType] = useState<SettlementType>('Payment');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const act = useAction();
  const needsAmount = type !== 'Query';
  return (
    <div className="stack" style={{ ['--gap' as string]: '20px' }}>
      <PageHead
        title="Settlements"
        lead="An admin’s own entries: payments taken outside the app, queries raised, queries resolved. They are added, never changed."
      />
      <section className="card stack">
        <Form
          error={act.error}
          onSubmit={() =>
            act.run(async () => {
              const paise = needsAmount ? toPaise(amount) : null;
              if (needsAmount && paise === null) throw new Error('Enter the amount in rupees.');
              await postJson(`${ws.api}/settlements`, {
                consumerId: who,
                forMonth,
                type,
                amount: paise,
                note: note.trim() || null,
              });
              setAmount('');
              setNote('');
              toast('Recorded.');
              list.reload();
              ws.reload();
            })
          }
        >
          <div className="pair">
            <Field label="Who" id="swho">
              <select id="swho" value={who} onChange={(e) => setWho(e.target.value)}>
                {consumers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Month" id="smonth">
              <select
                id="smonth"
                value={forMonth}
                onChange={(e) => setForMonth(e.target.value as typeof forMonth)}
              >
                {[...ws.boot.months].reverse().map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Type" id="stype">
              <select
                id="stype"
                value={type}
                onChange={(e) => setType(e.target.value as SettlementType)}
              >
                {SETTLEMENT_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            {needsAmount ? (
              <Field label="Amount (₹)" id="samount">
                <input
                  id="samount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
            ) : null}
          </div>
          <Field label="Note" id="snote">
            <input
              id="snote"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div>
            <button className="btn" disabled={act.busy || !ws.writable}>
              Record
            </button>
          </div>
        </Form>
      </section>
      <Problem error={list.error} />
      {list.loading && !list.data ? <Spinner /> : null}
      {list.data && list.data.length > 0 ? (
        <div
          className="tablewrap"
          tabIndex={0}
          role="region"
          aria-label="Table; scrolls sideways when it is wider than the screen"
        >
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Who</th>
                <th>Month</th>
                <th>Type</th>
                <th className="r">Amount</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((s) => (
                <tr key={s.id}>
                  <td>{date(s.date)}</td>
                  <td>{ws.nameOf(s.consumerId)}</td>
                  <td>{monthLabel(s.forMonth)}</td>
                  <td>{s.type}</td>
                  <td className="r">{s.amount === null ? '-' : money(s.amount)}</td>
                  <td className="cell-text">{s.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function CloseMonths() {
  const ws = useWorkspace();
  const { boot } = ws;
  // The latest month a close makes sense for is the one that has ended.
  const closable = boot.months.filter((m) => m < boot.currentMonth);
  const [selected, setSelected] = useState(closable.at(-1) ?? boot.currentMonth);
  const res = useLoad(
    () =>
      boot.rateCard
        ? getJson<StatementDto[]>(`${ws.api}/statements?months=${selected}`)
        : Promise.resolve([] as StatementDto[]),
    [ws.api, selected, boot.rateCard?.id],
  );
  const act = useAction();
  const [confirm, setConfirm] = useState<'all' | null>(null);
  const rows = res.data ?? [];
  const open = rows.filter((s) => !s.closed);
  return (
    <div className="stack" style={{ ['--gap' as string]: '20px' }}>
      <PageHead
        title="Month close"
        lead="Closing freezes what each person is billed. Entries changed later show up as “changed after close” with the difference, and never alter the bill."
        actions={
          <MonthPicker
            months={boot.months.length ? boot.months : [boot.currentMonth]}
            value={selected}
            onChange={setSelected}
            current={boot.currentMonth}
          />
        }
      />
      <Problem error={act.error ?? res.error} />
      {res.loading && !res.data ? <Spinner /> : null}
      {rows.length > 0 ? (
        <div
          className="tablewrap"
          tabIndex={0}
          role="region"
          aria-label="Table; scrolls sideways when it is wider than the screen"
        >
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th className="r">Live total</th>
                <th className="r">Billed</th>
                <th>State</th>
                <th>Still waiting</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.personId}>
                  <td>{s.name}</td>
                  <td className="r">{money(s.liveTotal)}</td>
                  <td className="r">{s.closed ? money(s.billed) : '-'}</td>
                  <td>
                    {s.closed ? <Chip tone="good">Closed</Chip> : <Chip>Open</Chip>}
                    {s.changedAfterClose !== 0 ? (
                      <Chip tone="bad">Changed after close {money(s.changedAfterClose)}</Chip>
                    ) : null}
                  </td>
                  <td>
                    {s.claimedPending > 0 ? (
                      <Chip tone="warn">{money(s.claimedPending)} claimed, not decided</Chip>
                    ) : null}
                    {s.openQueries > 0 ? (
                      <Chip tone="bad">
                        {s.openQueries} {s.openQueries === 1 ? 'query' : 'queries'} open
                      </Chip>
                    ) : null}
                    {s.claimedPending === 0 && s.openQueries === 0 ? '-' : null}
                  </td>
                  <td>
                    {s.closed ? (
                      <button
                        className="btn ghost small"
                        disabled={act.busy || !ws.writable}
                        onClick={() =>
                          void act.run(async () => {
                            await api.del(`${ws.api}/closes/${selected}/${s.personId}`);
                            toast('Reopened.');
                            res.reload();
                          })
                        }
                      >
                        Reopen
                      </button>
                    ) : (
                      <button
                        className="btn small"
                        disabled={act.busy || !ws.writable}
                        onClick={() =>
                          void act.run(async () => {
                            await postJson(`${ws.api}/closes`, {
                              month: selected,
                              consumerId: s.personId,
                            });
                            toast('Closed.');
                            res.reload();
                          })
                        }
                      >
                        Close
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {rows.length > 0 ? (
        <p className="muted small">
          Closing freezes meals, leave and extras. Payments are not frozen: a claim can still be
          made, confirmed or settled after the month is closed, so nobody has to rush the supplier.
        </p>
      ) : null}
      {open.length > 1 ? (
        <div>
          <button
            className="btn"
            disabled={act.busy || !ws.writable}
            onClick={() => setConfirm('all')}
          >
            Close {monthLabel(selected)} for everyone
          </button>
        </div>
      ) : null}
      <Dialog
        open={confirm === 'all'}
        onClose={() => setConfirm(null)}
        title={`Close ${monthLabel(selected)} for everyone?`}
      >
        <p>
          This freezes {open.length} bills. You can reopen any of them afterwards, and the reopening
          is recorded.
          {open.some((s) => s.claimedPending > 0 || s.openQueries > 0)
            ? ' Some of them still have a claim waiting for the supplier, or a query open. Those carry on after the close.'
            : ''}
        </p>
        <div className="row">
          <button
            className="btn"
            onClick={() =>
              void act.run(async () => {
                await postJson(`${ws.api}/closes`, { month: selected });
                setConfirm(null);
                toast('Closed.');
                res.reload();
              })
            }
          >
            Close them
          </button>
          <button className="btn ghost" onClick={() => setConfirm(null)}>
            Cancel
          </button>
        </div>
      </Dialog>
    </div>
  );
}
