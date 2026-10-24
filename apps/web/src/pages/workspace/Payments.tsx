import { useState } from 'react';
import { PAY_METHODS, type ClaimDto, type ClaimStatus, type PayMethod } from '@alimentation/core';
import { api, getJson, postJson } from '../../api.ts';
import {
  Chip,
  Dialog,
  Field,
  Form,
  Problem,
  Spinner,
  toast,
  useAction,
  useLoad,
} from '../../components/ui.tsx';
import { date, money, month as monthLabel, toPaise } from '../../format.ts';
import { useWorkspace } from './context.tsx';

const TONE: Record<ClaimStatus, 'good' | 'warn' | 'bad' | undefined> = {
  Pending: 'warn',
  Confirmed: 'good',
  Disputed: 'bad',
  Reversed: undefined,
};

function NewClaim({ onDone }: { onDone: () => void }) {
  const ws = useWorkspace();
  const consumers = ws.boot.people.filter((p) => p.role === 'consumer');
  const [who, setWho] = useState(
    ws.role === 'consumer' ? ws.boot.me.personId : (consumers[0]?.id ?? ''),
  );
  const [forMonth, setForMonth] = useState(ws.boot.currentMonth);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PayMethod>('UPI');
  const [paidAt, setPaidAt] = useState(ws.boot.today);
  const [ref, setRef] = useState('');
  const act = useAction();
  const paise = toPaise(amount);
  return (
    <section className="card stack" aria-label="Claim a payment">
      <h3>I paid</h3>
      <Form
        error={act.error}
        onSubmit={() =>
          act.run(async () => {
            if (paise === null || paise <= 0)
              throw new Error('Enter the amount in rupees, for example 3200.');
            await postJson(`${ws.api}/claims`, {
              consumerId: who,
              paidAt,
              forMonth,
              amount: paise,
              method,
              refNote: ref.trim() || null,
            });
            setAmount('');
            setRef('');
            toast('Claimed. It shows as pending until it is confirmed.');
            onDone();
            ws.reload();
          })
        }
      >
        <div className="pair">
          {ws.role !== 'consumer' ? (
            <Field label="For" id="cwho">
              <select id="cwho" value={who} onChange={(e) => setWho(e.target.value)}>
                {consumers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="For month" id="cmonth">
            <select
              id="cmonth"
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
          <Field label="Amount (₹)" id="camount">
            <input
              id="camount"
              inputMode="decimal"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Method" id="cmethod">
            <select
              id="cmethod"
              value={method}
              onChange={(e) => setMethod(e.target.value as PayMethod)}
            >
              {PAY_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Paid on" id="cpaid">
            <input
              id="cpaid"
              type="date"
              required
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
            />
          </Field>
        </div>
        <Field
          label="Reference (optional)"
          id="cref"
          hint="A UPI reference, or a note to remember it by."
        >
          <input id="cref" maxLength={300} value={ref} onChange={(e) => setRef(e.target.value)} />
        </Field>
        <div>
          <button className="btn" disabled={act.busy || !ws.writable}>
            Claim payment
          </button>
        </div>
      </Form>
    </section>
  );
}

function Decide({
  claim,
  mode,
  onClose,
  onDone,
}: {
  claim: ClaimDto;
  mode: 'dispute' | 'reverse';
  onClose: () => void;
  onDone: () => void;
}) {
  const ws = useWorkspace();
  const [reason, setReason] = useState('');
  const act = useAction();
  return (
    <Form
      error={act.error}
      onSubmit={() =>
        act.run(async () => {
          if (mode === 'dispute')
            await postJson(`${ws.api}/claims/${claim.id}/decision`, {
              decision: 'Disputed',
              note: reason,
            });
          else await postJson(`${ws.api}/claims/${claim.id}/reversal`, { reason });
          onDone();
          onClose();
        })
      }
    >
      <p className="muted">
        {ws.nameOf(claim.consumerId)} · {monthLabel(claim.forMonth)} · {money(claim.amount)} ·{' '}
        {claim.method}
      </p>
      <Field
        label={mode === 'dispute' ? 'Why is it disputed?' : 'Why is this decision being reversed?'}
        id="reason"
        hint="Recorded in the audit trail."
      >
        <textarea
          id="reason"
          required
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <div className="row">
        <button className="btn danger" disabled={act.busy || !reason.trim()}>
          {mode === 'dispute' ? 'Dispute' : 'Reverse'}
        </button>
        <button className="btn ghost" type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Form>
  );
}

export function Payments() {
  const ws = useWorkspace();
  const claims = useLoad(() => getJson<ClaimDto[]>(`${ws.api}/claims`), [ws.api]);
  const [dialog, setDialog] = useState<{ claim: ClaimDto; mode: 'dispute' | 'reverse' } | null>(
    null,
  );
  const decider = ws.role === 'supplier'; // only the supplier decides; the admin can reverse a decision
  const seesAll = ws.role !== 'consumer';
  const list = claims.data ?? [];
  const pending = list.filter((c) => c.status === 'Pending');

  const confirm = (c: ClaimDto) =>
    api.post(`${ws.api}/claims/${c.id}/decision`, { decision: 'Confirmed' }).then(
      () => {
        toast(`Confirmed ${money(c.amount)} from ${ws.nameOf(c.consumerId)}.`);
        claims.reload();
        ws.reload();
      },
      (e: Error) => toast(e.message),
    );

  return (
    <div className="stack" style={{ ['--gap' as string]: '20px' }}>
      <h1>{seesAll ? 'Payments' : 'My payments'}</h1>
      <Problem error={claims.error} />

      {seesAll ? (
        <section className="stack" aria-label="To confirm">
          <h3>To confirm {pending.length ? `(${pending.length})` : ''}</h3>
          {pending.length === 0 ? <p className="muted">Nothing is waiting for you.</p> : null}
          {!decider && pending.length > 0 ? (
            <p className="muted small">
              Only the supplier confirms a payment.
              {ws.boot.roles.includes('supplier')
                ? ' Switch to the supplier role at the top to do it yourself.'
                : ''}
            </p>
          ) : null}
          {pending.map((c) => (
            <div key={c.id} className="card row" style={{ justifyContent: 'space-between' }}>
              <div>
                <b>{ws.nameOf(c.consumerId)}</b> · {monthLabel(c.forMonth)} ·{' '}
                <b className="num">{money(c.amount)}</b>
                <div className="muted small">
                  {c.method} · paid {date(c.paidAt.slice(0, 10))}
                  {c.refNote ? ` · ${c.refNote}` : ''}
                </div>
              </div>
              {decider ? (
                <div className="row">
                  <button
                    className="btn small"
                    disabled={!ws.writable}
                    onClick={() => void confirm(c)}
                  >
                    Confirm
                  </button>
                  <button
                    className="btn ghost small"
                    disabled={!ws.writable}
                    onClick={() => setDialog({ claim: c, mode: 'dispute' })}
                  >
                    Dispute
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {ws.role === 'consumer' || ws.role === 'admin' ? <NewClaim onDone={claims.reload} /> : null}

      <section className="stack" aria-label="All claims">
        <h3>{seesAll ? 'All claims' : 'My claims'}</h3>
        {claims.loading && !claims.data ? <Spinner /> : null}
        {list.length === 0 && !claims.loading ? <p className="muted">No claims yet.</p> : null}
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
                  {seesAll ? <th>Who</th> : null}
                  <th>Month</th>
                  <th className="r">Amount</th>
                  <th>Method</th>
                  <th>Paid on</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    {seesAll ? <td>{ws.nameOf(c.consumerId)}</td> : null}
                    <td>{monthLabel(c.forMonth)}</td>
                    <td className="r">{money(c.amount)}</td>
                    <td>{c.method}</td>
                    <td>{date(c.paidAt.slice(0, 10))}</td>
                    <td>
                      <Chip tone={TONE[c.status]}>{c.status}</Chip>
                      {c.decisionNote ? (
                        <span className="muted small"> · {c.decisionNote}</span>
                      ) : null}
                      {c.reversalReason ? (
                        <span className="muted small"> · reversed: {c.reversalReason}</span>
                      ) : null}
                    </td>
                    <td>
                      {c.status === 'Pending' && ws.role !== 'supplier' && ws.writable ? (
                        <button
                          className="btn ghost small"
                          onClick={() =>
                            void api.del(`${ws.api}/claims/${c.id}`).then(
                              () => {
                                toast('Withdrawn.');
                                claims.reload();
                                ws.reload();
                              },
                              (e: Error) => toast(e.message),
                            )
                          }
                        >
                          Withdraw
                        </button>
                      ) : null}
                      {ws.role === 'admin' &&
                      (c.status === 'Confirmed' || c.status === 'Disputed') &&
                      ws.writable ? (
                        <button
                          className="btn ghost small"
                          onClick={() => setDialog({ claim: c, mode: 'reverse' })}
                        >
                          Reverse
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

      <Dialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog?.mode === 'dispute' ? 'Dispute this payment' : 'Reverse this decision'}
      >
        {dialog ? (
          <Decide
            claim={dialog.claim}
            mode={dialog.mode}
            onClose={() => setDialog(null)}
            onDone={() => {
              claims.reload();
              ws.reload();
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
