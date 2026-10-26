import { useMemo, useState } from 'react';
import { formatMoney, parseDate, weekdayOf } from '@alimentation/core';
import { Lines } from './motion.tsx';
import {
  CHAPATIS,
  SAMPLE_CARD,
  SAMPLE_MONTH_NAME,
  SAMPLE_PERSON,
  WEEKDAY_NAMES,
  STARTING_MARKS,
  board,
  nextMark,
  weeks,
  type Marks,
} from './month.ts';

const rupee = (p: number) => formatMoney(p).replace(/^-$/, '₹0');

/** Today’s steps at a glance, for the label a screen reader gets for each day. */
function sayDay(date: string, label: string) {
  const { d } = parseDate(date);
  return `${WEEKDAY_NAMES[weekdayOf(date)]} ${d} ${SAMPLE_MONTH_NAME}: ${label}. Press to change.`;
}

/**
 * The live thing on the page: one person’s month at a mess, on the real billing rules. Every
 * working day starts as the day’s meal; a tap steps a day through leave, switched dish and extra
 * chapatis, and the bill follows.
 */
export function Month() {
  const [marks, setMarks] = useState<Marks>(STARTING_MARKS);
  const { days, statement: s } = useMemo(() => board(marks), [marks]);
  const month = SAMPLE_MONTH_NAME;

  return (
    <div className="try hwrap">
      <div className="try-copy">
        <Lines lines={['Try a month', 'at the mess']} id="try-title" />
        <p className="statement" data-reveal>
          Everyone gets the day’s meal unless they say otherwise. Tap a day to log a leave, a switch
          or extra chapatis, and the bill follows.
        </p>
        <p className="muted small" data-reveal>
          A made-up kitchen with made-up prices, run on the same rules as the real thing. Payments
          work like this too: you say you paid, the cook confirms, and from then on it cannot be
          changed.
        </p>
      </div>

      <section
        className="board"
        aria-label={`${SAMPLE_PERSON.name}’s month at a sample mess`}
        data-reveal="board"
        data-ui
      >
        <header className="board-head">
          <h3>
            {SAMPLE_PERSON.name}, {month}
          </h3>
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
          {weeks().map((week) =>
            week.map((date) => {
              const day = days.get(date)!;
              const mark = marks[date] ?? 'meal';
              const meal = day.meal === 'Veg' ? 'Veg' : 'Non veg';
              const label =
                mark === 'leave'
                  ? 'Leave, no meal, ₹0'
                  : `${meal}, ${rupee(day.dayTotal)}${
                      mark === 'switch'
                        ? ', switched'
                        : mark === 'chapati'
                          ? `, with ${CHAPATIS} extra chapatis`
                          : ''
                    }`;
              return (
                <button
                  key={date}
                  type="button"
                  className={`day day-${mark}`}
                  aria-label={sayDay(date, label)}
                  onClick={() => setMarks((m) => ({ ...m, [date]: nextMark(m[date]) }))}
                >
                  <span className="d" aria-hidden="true">
                    {parseDate(date).d}
                  </span>
                  <span className="m" aria-hidden="true">
                    {mark === 'leave' ? 'Leave' : meal}
                  </span>
                  <span className="p" aria-hidden="true">
                    {mark === 'leave' ? '–' : rupee(day.dayTotal)}
                  </span>
                  {mark === 'chapati' ? (
                    <span className="plus" aria-hidden="true">
                      +{CHAPATIS}
                    </span>
                  ) : null}
                </button>
              );
            }),
          )}
        </div>

        <ul className="board-key" aria-hidden="true">
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
          <p className="total">
            <span>
              {SAMPLE_PERSON.name}’s bill for {month}
            </span>
            <b key={s.liveTotal}>{rupee(s.liveTotal)}</b>
          </p>
          <button type="button" className="again" onClick={() => setMarks({})}>
            Clear every change
          </button>
        </footer>
      </section>
    </div>
  );
}
