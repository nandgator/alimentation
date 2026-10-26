import { useMemo, useState } from 'react';
import { addMonths, formatMoney, monthOf, parseDate, weekdayOf } from '@alimentation/core';
import { Lines } from './motion.tsx';
import {
  CHAPATIS,
  SAMPLE_CARD,
  SAMPLE_PERSON,
  WEEKDAY_NAMES,
  board,
  dayLabel,
  isFrozen,
  monthLabel,
  nextMark,
  startingMarks,
  todayIso,
  weeks,
  type Marks,
} from './month.ts';

const rupee = (p: number) => formatMoney(p).replace(/^-$/, '₹0');
const monthName = (label: string) => label.split(' ')[0];

function Lock() {
  return (
    <svg className="lock" viewBox="0 0 12 14" width="10" height="12" aria-hidden="true">
      <rect x="1" y="6" width="10" height="8" rx="2" fill="currentColor" />
      <path d="M3.5 6V4a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/**
 * The live thing on the page: one person’s month at a mess, on the real billing rules, against the
 * visitor’s own calendar. Every working day starts as the day’s meal. Days up to today have happened
 * and are frozen; a tap on a day still to come steps it through leave, switched dish and extra
 * chapatis, and the bill follows.
 */
export function Month({ now }: { now?: Date }) {
  const today = useMemo(() => todayIso(now), [now]);
  const [offset, setOffset] = useState(0);
  const [marks, setMarks] = useState<Marks>(() => startingMarks(today));
  const month = addMonths(monthOf(today), offset);
  const { days, statement: s } = useMemo(() => board(marks, today, month), [marks, today, month]);
  const name = monthName(monthLabel(month));
  const done = s.basis === 'Actual';
  const todayDate = parseDate(today);

  return (
    <div className="try hwrap">
      <div className="try-copy">
        <Lines lines={['Try a month', 'at the mess']} id="try-title" />
        <p className="statement" data-reveal>
          Everyone gets the day’s meal unless they say otherwise. Days gone by are frozen; tap a day
          to come to change it.
        </p>
        <p className="muted small" data-reveal>
          A made-up kitchen with made-up prices, run on the same rules as the real thing, on today’s
          real calendar. Payments work like this too: you say you paid, the cook confirms, and from
          then on it cannot be changed.
        </p>
      </div>

      <section
        className="board"
        aria-label={`${SAMPLE_PERSON.name}’s month at a sample mess`}
        data-reveal="board"
        data-ui
      >
        <header className="board-head">
          <div className="board-nav">
            <button
              type="button"
              className="step"
              aria-label="Previous month"
              disabled={offset <= -1}
              onClick={() => setOffset((o) => o - 1)}
            >
              ‹
            </button>
            <h3>
              {SAMPLE_PERSON.name}, {monthLabel(month)}
            </h3>
            <button
              type="button"
              className="step"
              aria-label="Next month"
              disabled={offset >= 1}
              onClick={() => setOffset((o) => o + 1)}
            >
              ›
            </button>
          </div>
          <p>
            Veg {rupee(SAMPLE_CARD.veg)} · Non-veg {rupee(SAMPLE_CARD.nonVeg)} · Extra chapati{' '}
            {rupee(SAMPLE_CARD.extraChapati)}
          </p>
        </header>

        <div className="board-cols" aria-hidden="true">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((n) => (
            <span key={n}>{n}</span>
          ))}
        </div>
        <div className="board-days" role="group" aria-label="Working days, Monday to Friday">
          {weeks(month).flatMap((row, r) =>
            row.map((date, c) => {
              if (monthOf(date) !== month)
                return (
                  <span key={`${r}-${c}`} className="day-out" aria-hidden="true">
                    {parseDate(date).d}
                  </span>
                );
              const day = days.get(date)!;
              const mark = marks[date] ?? 'meal';
              const frozen = isFrozen(date, today);
              const isToday = date === today;
              const meal = day.meal === 'Veg' ? 'Veg' : 'Non veg';
              const what =
                mark === 'leave'
                  ? 'Leave, no meal, ₹0'
                  : `${meal}, ${rupee(day.dayTotal)}${
                      mark === 'switch'
                        ? ', switched'
                        : mark === 'chapati'
                          ? `, with ${CHAPATIS} extra chapatis`
                          : ''
                    }`;
              const state = frozen
                ? `${isToday ? 'today, ' : ''}frozen`
                : 'tentative. Press to change';
              return (
                <button
                  key={date}
                  type="button"
                  className={`day day-${mark} ${frozen ? 'is-frozen' : 'is-open'}${isToday ? ' is-today' : ''}`}
                  aria-label={`${dayLabel(date)}: ${what}, ${state}.`}
                  disabled={frozen}
                  onClick={() => setMarks((m) => ({ ...m, [date]: nextMark(m[date]) }))}
                >
                  <span className="d" aria-hidden="true">
                    {parseDate(date).d}
                  </span>
                  <span className="m" aria-hidden="true">
                    {mark === 'leave' ? 'Leave' : meal}
                  </span>
                  <span className="p" aria-hidden="true">
                    {mark === 'leave' ? '–' : `${frozen ? '' : '~'}${rupee(day.dayTotal)}`}
                  </span>
                  {mark === 'chapati' ? (
                    <span className="plus" aria-hidden="true">
                      +{CHAPATIS}
                    </span>
                  ) : null}
                  {isToday ? (
                    <span className="tag" aria-hidden="true">
                      Today
                    </span>
                  ) : frozen ? (
                    <Lock />
                  ) : null}
                </button>
              );
            }),
          )}
        </div>

        <ul className="board-key" aria-hidden="true">
          <li>
            <i className="k-today" /> Today
          </li>
          <li>
            <i className="k-frozen" /> Frozen: it has happened
          </li>
          <li>
            <i className="k-open" /> Tentative: still to come
          </li>
          <li>
            <i className="k-leave" /> Leave
          </li>
          <li>
            <i className="k-switch" /> Switched dish
          </li>
          <li>
            <i className="k-chapati" /> {CHAPATIS} extra chapatis
          </li>
        </ul>
        <p className="board-today">
          Today is {WEEKDAY_NAMES[weekdayOf(today)]} {todayDate.d}{' '}
          {monthName(monthLabel(monthOf(today)))}.
        </p>

        <footer className="board-bill" aria-live="polite">
          <dl>
            <div>
              <dt>{s.counts.meals} meals</dt>
              <dd>{rupee(s.mealsAmount)}</dd>
            </div>
            <div>
              <dt>{s.counts.extraChapati} extra chapatis</dt>
              <dd>{rupee(s.breadAmount)}</dd>
            </div>
            <div>
              <dt>Month’s extras, for papad, salad and the like</dt>
              <dd>{rupee(s.extrasAmount)}</dd>
            </div>
          </dl>
          {!done && s.actualToDate > 0 ? (
            <p className="sofar">
              <span>Frozen so far</span>
              <b>{rupee(s.actualToDate)}</b>
            </p>
          ) : null}
          <p className="total">
            <span>
              {SAMPLE_PERSON.name}’s bill for {name}
              {done ? '' : ', expected'}
            </span>
            <b key={s.liveTotal}>{rupee(s.liveTotal)}</b>
          </p>
          <button
            type="button"
            className="again"
            onClick={() =>
              setMarks((m) =>
                Object.fromEntries(Object.entries(m).filter(([date]) => isFrozen(date, today))),
              )
            }
          >
            Clear the changes still to come
          </button>
        </footer>
      </section>
    </div>
  );
}
