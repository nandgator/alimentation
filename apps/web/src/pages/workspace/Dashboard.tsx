import { useMemo, useState } from 'react';
import { STATUS_LABEL, addMonths, type StatementDto } from '@alimentation/core';
import { BarChart } from '../../components/Chart.tsx';
import {
  Chip,
  MonthPicker,
  PageHead,
  Problem,
  Spinner,
  Tile,
  useLoad,
} from '../../components/ui.tsx';
import { getJson } from '../../api.ts';
import { date, money, month as monthLabel } from '../../format.ts';
import { useWorkspace } from './context.tsx';

const TONE: Record<string, 'good' | 'warn' | 'bad' | undefined> = {
  SETTLED: 'good',
  DUE: 'warn',
  PART_PAID: 'warn',
  AWAITING_CONFIRMATION: 'warn',
  QUERY_OPEN: 'bad',
  CHANGED_AFTER_CLOSE: 'bad',
};

const sum = (xs: StatementDto[], f: (s: StatementDto) => number) =>
  xs.reduce((a, s) => a + f(s), 0);

export function Dashboard() {
  const ws = useWorkspace();
  const { boot } = ws;
  const [selected, setSelected] = useState<string>(boot.currentMonth);
  // Six months ending with the selected one, never before the first month with anything to bill.
  const range = useMemo(() => {
    const first = boot.months[0] ?? boot.currentMonth;
    const out: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const m = addMonths(selected as never, -i);
      if (m >= first) out.push(m);
    }
    return out.length ? out : [selected];
  }, [boot.months, boot.currentMonth, selected]);

  const stm = useLoad(
    () =>
      boot.rateCard
        ? getJson<StatementDto[]>(`${ws.api}/statements?months=${range.join(',')}`)
        : Promise.resolve([] as StatementDto[]),
    [ws.api, range.join(','), boot.rateCard?.id],
  );

  const all = stm.data ?? [];
  const mine = all.filter((s) => s.month === selected);
  const consumers = [...new Set(all.map((s) => s.personId))];
  const single = ws.role === 'consumer';
  const projected = mine.length > 0 && mine.every((s) => s.basis === 'Projected');

  const series = consumers.map((id) => ({
    name: single ? 'Bill' : ws.nameOf(id),
    values: range.map((m) => all.find((s) => s.personId === id && s.month === m)?.billed ?? null),
  }));
  const rateLine = boot.rateCard
    ? `Veg ${money(boot.rateCard.veg)} · Non Veg ${money(boot.rateCard.nonVeg)} · Chapati ${money(boot.rateCard.extraChapati)} · Bhakri ${money(boot.rateCard.extraBhakri)} · Extras ${money(boot.rateCard.extrasPerMonth)}/month · from ${date(boot.rateCard.effectiveFrom)}`
    : null;

  return (
    <div className="stack" style={{ ['--gap' as string]: '20px' }}>
      <PageHead
        title="Dashboard"
        lead={
          single
            ? `Hello, ${boot.me.name}. What you owe, and what you have paid.`
            : 'Who owes what, and what has been paid.'
        }
        actions={
          <>
            <Chip tone={projected ? undefined : 'good'}>{projected ? 'Projected' : 'Actual'}</Chip>
            <MonthPicker
              months={boot.months.length ? boot.months : [boot.currentMonth]}
              value={selected}
              onChange={setSelected}
              current={boot.currentMonth}
            />
          </>
        }
      />
      <Problem error={stm.error} />
      {stm.loading && !stm.data ? <Spinner /> : null}

      {mine.length > 0 ? (
        <div className="tilegroups">
          <div className="tiles lead">
            <Tile
              lead
              label="Bill"
              value={money(sum(mine, (s) => s.billed))}
              projected={projected}
            />
            <Tile lead label="Paid" value={money(sum(mine, (s) => s.paid))} />
            <Tile
              lead
              label="Balance"
              value={money(sum(mine, (s) => s.balance))}
              projected={projected}
            />
          </div>
          <div className="tiles">
            <Tile label="Actual to date" value={money(sum(mine, (s) => s.actualToDate))} />
            <Tile label="Claimed" value={money(sum(mine, (s) => s.claimedPending))} />
            <Tile label="Earlier unpaid" value={money(sum(mine, (s) => s.earlierUnpaid))} />
            {single && mine[0] ? (
              <Tile
                label="Status"
                value={<span className="tile-text">{STATUS_LABEL[mine[0].status]}</span>}
              />
            ) : null}
            {!single ? <Tile label="To confirm" value={boot.pendingClaims || '-'} /> : null}
          </div>
        </div>
      ) : !stm.loading && boot.rateCard ? (
        <p className="muted">Nothing to show for {monthLabel(selected)} yet.</p>
      ) : null}

      {!single && mine.length > 0 ? (
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
                <th className="r">Meals</th>
                <th className="r">Leave</th>
                <th className="r">Bill</th>
                <th className="r">Actual</th>
                <th className="r">Paid</th>
                <th className="r">Balance</th>
                <th>Status</th>
                <th className="r">Earlier unpaid</th>
                <th className="r">Claimed</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((s) => (
                <tr key={s.personId} className={s.basis === 'Projected' ? 'projected' : ''}>
                  <td>{s.name}</td>
                  <td className="r">{s.counts.meals}</td>
                  <td className="r">{s.counts.leave || '-'}</td>
                  <td className="r">{money(s.billed)}</td>
                  <td className="r">{money(s.actualToDate)}</td>
                  <td className="r">{money(s.paid)}</td>
                  <td className="r">{money(s.balance)}</td>
                  <td>
                    <Chip tone={TONE[s.status]}>{STATUS_LABEL[s.status]}</Chip>
                  </td>
                  <td className="r">{money(s.earlierUnpaid)}</td>
                  <td className="r">{money(s.claimedPending)}</td>
                </tr>
              ))}
            </tbody>
            {mine.length > 1 ? (
              <tfoot>
                <tr>
                  <th>Receivable</th>
                  <th />
                  <th />
                  <th className="r">{money(sum(mine, (s) => s.billed))}</th>
                  <th className="r">{money(sum(mine, (s) => s.actualToDate))}</th>
                  <th className="r">{money(sum(mine, (s) => s.paid))}</th>
                  <th className="r">{money(sum(mine, (s) => s.balance))}</th>
                  <th />
                  <th className="r">{money(sum(mine, (s) => s.earlierUnpaid))}</th>
                  <th className="r">{money(sum(mine, (s) => s.claimedPending))}</th>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      ) : null}

      {single && mine[0] && mine[0].changedAfterClose !== 0 ? (
        <div className="banner warn">
          This month was closed, and entries changed afterwards by{' '}
          {money(Math.abs(mine[0].changedAfterClose))}.
        </div>
      ) : null}

      {series.length > 0 ? (
        <section className="card stack" aria-label="Monthly bill">
          <h2>Monthly bill</h2>
          <BarChart
            categories={range}
            projected={range.map((m) =>
              all.filter((s) => s.month === m).every((s) => s.basis === 'Projected'),
            )}
            series={series}
            label={
              single
                ? 'Your bill for each of the last months'
                : 'Each person’s bill for each of the last months'
            }
          />
        </section>
      ) : null}
      {rateLine ? <p className="muted small">{rateLine}</p> : null}
    </div>
  );
}
