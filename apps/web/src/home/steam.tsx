import { useId, type CSSProperties } from 'react';

/*
 * Steam over a lid. A wisp is one long S-curve, anchored behind the lid, along which a stretch of line travels up
 * and thins into the air: it is never a shape that comes loose and floats, which is what makes steam look drawn
 * on. The curve is made here from a few numbers; the stylesheet moves the travelling stretch (`.wisp` in home.css).
 *
 * What keeps it from looking mechanical: it starts behind the lid, so it comes out of something; each wisp has its
 * own length, thickness, lean and sway, so no two are alike; and it thins by a mask fixed to the scene, so a stretch
 * is solid by the lid and gone higher up, as steam is.
 *
 * What keeps it steady: the wisps of one lid all take the same time for a trip and are started at evenly spread
 * points of it. Wisps on different times drift into step every so often and the lid goes quiet for a moment, then
 * puffs; on one time they stay where they were put, so there is always steam coming out.
 */

export interface Wisp {
  /** Where it leaves the lid, across, in the units of whatever the steam is drawn inside. */
  x: number;
  /** Its length and its thickness. */
  h: number;
  thick: number;
  /** How much its middle meanders, which way its top leans, and where in the meander it starts. */
  bend: number;
  lean: number;
  phase: number;
  /** How much of its length is lit as it travels (0 to 1). */
  dash: number;
  /** How far it swings to either side, in degrees, and how long a swing takes, in seconds. */
  sway: number;
  swing: number;
  /** How far along its trip it is when the page loads (0 to 1, spread round the lid), and how dense it is. */
  start: number;
  peak: number;
}

export interface Vent {
  /** Where the lid's top edge is, and where the steam has all but gone, in the same units. */
  lid: number;
  gone: number;
  /** How long one trip up a wisp takes, in seconds, the same for every wisp of the lid. */
  life: number;
  wisps: Wisp[];
}

/** One wisp per row, in the order of `Wisp`. */
type Row = [
  x: number,
  h: number,
  thick: number,
  bend: number,
  lean: number,
  phase: number,
  dash: number,
  sway: number,
  swing: number,
  start: number,
  peak: number,
];
const wisps = (rows: Row[]): Wisp[] =>
  rows.map(([x, h, thick, bend, lean, phase, dash, sway, swing, start, peak]) => ({
    x,
    h,
    thick,
    bend,
    lean,
    phase,
    dash,
    sway,
    swing,
    start,
    peak,
  }));

/**
 * The carrier's lid, in the carrier's own coordinates (200 wide, the lid's top edge at 42), clear of its handle. The
 * two sides are not alike: one plume is taller and thicker, and sways on a clock of its own.
 */
export const CARRIER_VENT: Vent = {
  lid: 42,
  gone: -62,
  life: 4,
  wisps: wisps([
    [40, 150, 12, 17, -10, 0.4, 0.66, 4.0, 3.6, 0.05, 0.86],
    [58, 118, 8, 12, 8, 2.7, 0.58, 3.0, 4.3, 0.5, 0.7],
    [156, 140, 11, 16, 9, 1.9, 0.64, 4.0, 3.9, 0.25, 0.8],
    [170, 104, 8, 11, -7, 4.0, 0.54, 3.0, 4.8, 0.75, 0.68],
  ]),
};

/** The pot's lid, in the hero picture's own coordinates, either side of its knob. Its own pace, so the two lids do not pulse together. */
export const POT_VENT: Vent = {
  lid: 368,
  gone: 270,
  life: 3.6,
  wisps: wisps([
    [478, 122, 9, 12, -8, 1.0, 0.64, 4.0, 3.3, 0.08, 0.82],
    [526, 98, 7, 9, 7, 3.4, 0.54, 3.0, 4.1, 0.58, 0.66],
  ]),
};

type Point = [number, number];

const fmt = ([x, y]: Point) => `${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}`;
const between = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/**
 * The line of one wisp, from the vent (0, 0) straight up its length: a sine that meanders more the higher it goes.
 * It is smoothed through the middle of each pair of its points, so it has no corners.
 */
export function wispPath(w: Pick<Wisp, 'h' | 'bend' | 'lean' | 'phase'>): string {
  const N = 12;
  const pts: Point[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const meander = Math.sin(2 * Math.PI * 1.15 * t + w.phase) - Math.sin(w.phase);
    pts.push([w.lean * t + w.bend * meander * (0.3 + 0.7 * t), -w.h * t]);
  }
  let d = `M${fmt(pts[0]!)}L${fmt(between(pts[0]!, pts[1]!))}`;
  for (let i = 1; i < N; i++) d += `Q${fmt(pts[i]!)} ${fmt(between(pts[i]!, pts[i + 1]!))}`;
  return `${d}L${fmt(pts[N]!)}`;
}

/** The room the air covers: every wisp's meander either side, from above where it is gone to below the lid. */
function room(v: Vent) {
  const xs = v.wisps.map((w) => w.x);
  const x = Math.min(...xs) - 60;
  return { x, y: v.gone - 10, width: Math.max(...xs) + 60 - x, height: v.lid - v.gone + 40 };
}

/**
 * Steam from one lid. Draw it inside the lid's own coordinates, after whatever is behind the lid and before the lid
 * itself, so the lid is in front of where each wisp starts.
 */
export function Steam({ vent }: { vent: Vent }) {
  const id = `steam-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const area = room(vent);
  return (
    <g className="steam">
      <defs>
        <linearGradient
          id={`${id}-ramp`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          x2="0"
          y1={vent.gone}
          y2={vent.lid}
        >
          <stop offset="0" stopOpacity="0" />
          <stop offset="0.3" stopOpacity="0.45" />
          <stop offset="0.6" stopOpacity="0.95" />
          <stop offset="1" stopOpacity="1" />
        </linearGradient>
        <mask id={id} className="air" maskUnits="userSpaceOnUse" {...area}>
          <rect {...area} fill={`url(#${id}-ramp)`} />
        </mask>
      </defs>
      <g mask={`url(#${id})`}>
        {vent.wisps.map((w, i) => (
          // Four units into the lid, so a wisp's foot is behind it.
          <g key={i} transform={`translate(${w.x} ${vent.lid + 4})`}>
            <g
              className="wisp"
              style={
                {
                  '--sway': w.sway,
                  '--swing': `${w.swing}s`,
                  '--life': `${vent.life}s`,
                  '--at': `${-w.start * vent.life}s`,
                  '--dash': w.dash,
                  // Wholly before the line, with a little over for the round end.
                  '--before': w.dash + 0.1,
                  '--thick': w.thick,
                  '--peak': w.peak,
                } as CSSProperties
              }
            >
              <path d={wispPath(w)} pathLength={1} />
            </g>
          </g>
        ))}
      </g>
    </g>
  );
}
