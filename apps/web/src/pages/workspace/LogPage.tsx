import { useEffect, useState } from 'react';
import {
  LOG_CHANGES,
  addMonths,
  monthEnd,
  monthStart,
  type Issue,
  type LogChange,
  type LogEntryDto,
} from '@alimentation/core';
import { api, getJson, postJson } from '../../api.ts';
import {
  Chip,
  Field,
  Form,
  Problem,
  Spinner,
  toast,
  useAction,
  useLoad,
} from '../../components/ui.tsx';
import { date } from '../../format.ts';
import { useWorkspace } from './context.tsx';

const EVERYONE = 'all';

export function LogPage() {
  const ws = useWorkspace();
  const { boot } = ws;
  const consumers = boot.people.filter((p) => p.role === 'consumer');
  const mayManage = ws.role !== 'consumer';
  const [who, setWho] = useState(mayManage ? (consumers[0]?.id ?? EVERYONE) : boot.me.personId);
  const [day, setDay] = useState(boot.today);
  const [change, setChange] = useState<LogChange>('Leave');
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState('');
  const [issues, setIssues] = useState<Issue[]>([]);
  const act = useAction();

  const choices = LOG_CHANGES.filter((c) => (mayManage ? true : c !== 'Supplier Off'));
  const needsQty = change === 'Extra Chapati' || change === 'Extra Bhakri';
  const forEveryone = change === 'Supplier Off';
  const body = {
    date: day,
    personId: forEveryone ? null : who === EVERYONE ? null : who,
    allConsumers: forEveryone,
    change,
    qty: needsQty ? Number(qty) || 1 : null,
    note: note.trim() || null,
  };

  // Tell the person what is wrong before they press the button, not after.
  useEffect(() => {
    if (!day || (!forEveryone && who === EVERYONE)) return setIssues([]);
    const t = setTimeout(() => {
      postJson<{ issues: Issue[] }>(`${ws.api}/log/check`, body).then(
        (r) => setIssues(r.issues),
        () => setIssues([]),
      );
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, change, qty, who, forEveryone, ws.api]);

  const from = monthStart(addMonths(boot.currentMonth, -1));
  const to = monthEnd(addMonths(boot.currentMonth, 1));
  const list = useLoad(
    () => getJson<LogEntryDto[]>(`${ws.api}/log?from=${from}&to=${to}`),
    [ws.api, from, to],
  );
  const blocked = issues.some((i) => i.severity === 'error');

  return (
    <div className="stack" style={{ ['--gap' as string]: '20px' }}>
      <h1>{mayManage ? 'Log' : 'My log'}</h1>
      <section className="card stack" aria-label="Add an entry">
        <Form
          error={act.error}
          onSubmit={() =>
            act.run(async () => {
              await postJson(`${ws.api}/log`, body);
              setNote('');
              toast('Saved.');
              list.reload();
              ws.reload();
            })
          }
        >
          <div className="pair">
            {mayManage && !forEveryone ? (
              <Field label="For" id="who">
                <select id="who" value={who} onChange={(e) => setWho(e.target.value)}>
                  {consumers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label="Date" id="day">
              <input
                id="day"
                type="date"
                required
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </Field>
            <Field label="Change" id="change">
              <select
                id="change"
                value={change}
                onChange={(e) => setChange(e.target.value as LogChange)}
              >
                {choices.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            {needsQty ? (
              <Field label="How many" id="qty">
                <input
                  id="qty"
                  type="number"
                  min={1}
                  max={20}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </Field>
            ) : null}
          </div>
          {forEveryone ? (
            <p className="muted small">A day the kitchen is off applies to everyone.</p>
          ) : null}
          <Field label="Note (optional)" id="note">
            <input
              id="note"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          {issues.map((i, k) => (
            <div
              key={k}
              className={`banner ${i.severity === 'error' ? 'bad' : 'warn'}`}
              role="status"
            >
              {i.message}
            </div>
          ))}
          <div>
            <button className="btn" disabled={act.busy || blocked || !ws.writable}>
              Add
            </button>
          </div>
        </Form>
      </section>

      <section className="stack">
        <h3>Recent entries</h3>
        <Problem error={list.error} />
        {list.loading && !list.data ? <Spinner /> : null}
        {list.data && list.data.length === 0 ? <p className="muted">Nothing logged yet.</p> : null}
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
                  <th>Change</th>
                  <th className="r">Qty</th>
                  <th>Note</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.map((e) => (
                  <tr key={e.id}>
                    <td>{date(e.date)}</td>
                    <td>
                      {e.allConsumers ? 'Everyone' : e.personId ? ws.nameOf(e.personId) : '-'}
                    </td>
                    <td>
                      <Chip tone={e.change === 'Leave' ? 'warn' : undefined}>{e.change}</Chip>
                    </td>
                    <td className="r">{e.qty ?? '-'}</td>
                    <td style={{ whiteSpace: 'normal', maxWidth: 260 }}>{e.note ?? ''}</td>
                    <td>
                      {ws.writable ? (
                        <button
                          className="btn ghost small"
                          onClick={() =>
                            void api.del(`${ws.api}/log/${e.id}`).then(
                              () => {
                                toast('Removed.');
                                list.reload();
                                ws.reload();
                              },
                              (err: Error) => toast(err.message),
                            )
                          }
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
