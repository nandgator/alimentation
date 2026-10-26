import { useEffect, useRef, useState } from 'react';
import { month as monthLabel, money } from '../format.ts';

export interface Series {
  name: string;
  /** One value per category; `null` where there is nothing to draw. */
  values: (number | null)[];
}

/**
 * Grouped bars: months across, one bar per series. Months that are only projected are
 * drawn lighter and starred, as the spec asks. A table of the same figures sits behind a
 * disclosure, so nothing depends on seeing the picture.
 */
export function BarChart({
  categories,
  projected,
  series,
  label,
}: {
  categories: string[];
  projected: boolean[];
  series: Series[];
  label: string;
}) {
  // Drawn at the width it is shown at, so the labels keep their size on a phone.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setW(Math.max(260, Math.floor(el.getBoundingClientRect().width)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 220;
  const pad = { l: 52, r: 8, t: 12, b: 28 };
  const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  // A round top for the scale: 1, 2 or 5 times a power of ten.
  const pow = 10 ** Math.floor(Math.log10(max));
  const top = [1, 2, 5, 10].map((m) => m * pow).find((t) => t >= max) ?? max;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const band = iw / Math.max(1, categories.length);
  const bw = Math.min(34, (band * 0.7) / Math.max(1, series.length));
  const y = (v: number) => pad.t + ih - (v / top) * ih;
  const ticks = [0, 0.5, 1].map((f) => f * top);

  return (
    <figure style={{ margin: 0 }} className="stack">
      <div ref={box} style={{ width: '100%' }}>
        <svg
          className="chart"
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={label}
          style={{ display: 'block' }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end">
                {t === 0 ? '0' : money(Math.round(t))}
              </text>
            </g>
          ))}
          {categories.map((c, i) => {
            const x0 = pad.l + i * band + (band - bw * series.length) / 2;
            return (
              <g key={c}>
                {series.map((s, j) => {
                  const v = s.values[i];
                  if (v === null || v === undefined || v <= 0) return null;
                  return (
                    <rect
                      key={s.name}
                      className={`s${Math.min(j, 3)} ${projected[i] ? 'proj' : ''}`}
                      x={x0 + j * bw}
                      y={y(v)}
                      width={bw - 2}
                      height={pad.t + ih - y(v)}
                      rx="3"
                    >
                      <title>{`${s.name} · ${monthLabel(c)}${projected[i] ? ' (projected)' : ''} · ${money(v)}`}</title>
                    </rect>
                  );
                })}
                <text x={pad.l + i * band + band / 2} y={H - 8} textAnchor="middle">
                  {monthLabel(c)}
                  {projected[i] ? '*' : ''}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {series.length > 1 ? (
        <div className="legend">
          {series.map((s, j) => (
            <span key={s.name}>
              <i
                className={`s${Math.min(j, 3)}`}
                style={{
                  background: `var(--${['brand', 'accent', 'ink-2', 'hair'][Math.min(j, 3)]})`,
                }}
              />
              {s.name}
            </span>
          ))}
        </div>
      ) : null}
      <details>
        <summary className="muted small" style={{ cursor: 'pointer' }}>
          Show these figures as a table
        </summary>
        <div
          className="tablewrap"
          tabIndex={0}
          role="region"
          aria-label="Table; scrolls sideways when it is wider than the screen"
          style={{ marginTop: 8 }}
        >
          <table>
            <thead>
              <tr>
                <th>Month</th>
                {series.map((s) => (
                  <th key={s.name} className="r">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((c, i) => (
                <tr key={c}>
                  <td>
                    {monthLabel(c)}
                    {projected[i] ? '*' : ''}
                  </td>
                  {series.map((s) => (
                    <td key={s.name} className="r">
                      {money(s.values[i] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">* projected</p>
      </details>
    </figure>
  );
}
