import type { ReactNode } from 'react';
import { CARRIER_VENT, POT_VENT, Steam } from './steam.tsx';

/*
 * The home page's pictures, drawn in code from the subject itself: a tiffin carrier, a steel shelf,
 * tiled walls. Flat colour only (the steam is flat too, only thinner). The steel tones are fixed
 * (not themed) because every picture sits on a green tiled wall in both light and dark mode.
 */

/** The tile pattern every wall uses. Mounted once, referenced by id. */
export function Defs() {
  return (
    <svg className="defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="tiles" width="96" height="96" patternUnits="userSpaceOnUse">
          <rect width="96" height="96" className="grout" />
          <rect x="2" y="2" width="92" height="44" rx="3" className="glaze" />
          <rect x="-46" y="50" width="92" height="44" rx="3" className="glaze" />
          <rect x="50" y="50" width="92" height="44" rx="3" className="glaze" />
        </pattern>
      </defs>
    </svg>
  );
}

export type Clip = 'mine' | 'plain';

/**
 * One tiffin carrier, 200 wide and 312 tall in its own coordinates: a handle on two posts, a lid, three
 * tiers and the two clips that hold them. Each part has its own class so a page can move them one by one.
 */
export function Carrier({ clip = 'mine' }: { clip?: Clip }) {
  const tiers = [76, 150, 224];
  return (
    <g className={`carrier clip-${clip}`}>
      <g className="c-base">
        <rect x="36" y="294" width="128" height="12" rx="6" className="s4" />
      </g>
      {[...tiers].reverse().map((y, i) => (
        <g key={y} className={`c-tier c-tier-${3 - i}`}>
          <rect x="30" y={y} width="140" height="66" rx="10" className="s2" />
          <rect x="38" y={y + 6} width="12" height="54" rx="6" className="s1" />
          <rect x="148" y={y + 6} width="14" height="54" rx="7" className="s3" />
          <rect x="30" y={y} width="140" height="8" rx="4" className="s3" />
          <rect x="30" y={y + 58} width="140" height="8" rx="4" className="s3" />
        </g>
      ))}
      <g className="c-lid">
        <rect x="22" y="42" width="156" height="30" rx="15" className="s2" />
        <rect x="22" y="62" width="156" height="10" rx="5" className="s3" />
        <rect x="34" y="47" width="132" height="6" rx="3" className="s1" />
      </g>
      <g className="c-handle">
        <rect x="78" y="14" width="9" height="30" className="s4" />
        <rect x="113" y="14" width="9" height="30" className="s4" />
        <rect x="64" y="4" width="72" height="12" rx="6" className="s3" />
        <rect x="70" y="6" width="60" height="3" rx="1.5" className="s1" />
      </g>
      <g className="c-clips">
        <rect x="8" y="54" width="13" height="246" rx="6.5" className="clip" />
        <rect x="179" y="54" width="13" height="246" rx="6.5" className="clip" />
        <rect x="4" y="58" width="21" height="16" rx="6" className="clip-cap" />
        <rect x="175" y="58" width="21" height="16" rx="6" className="clip-cap" />
      </g>
    </g>
  );
}

/** What a carrier fills in its own units, clips and all: the box to find on the screen when it is somewhere. */
export const CARRIER_BOX = { x: 4, y: 4, width: 192, height: 302 } as const;

/** The hero picture's frame, and where its carrier stands in it, in the picture's own units (see `HeroScene`). */
export const HERO = { width: 560, height: 496, carrierAt: { x: 250, y: 134 } } as const;

/** A steel plank on two brackets, `w` wide, with its top edge at `y`. */
export function Shelf({ x, y, w }: { x: number; y: number; w: number }) {
  return (
    <g className="shelf">
      <rect x={x + 6} y={y + 12} width={w - 12} height="9" rx="4.5" className="cast" />
      <path d={`M${x + 36} ${y + 14}h14v34l-14-14z`} className="s4" />
      <path d={`M${x + w - 50} ${y + 14}h14v20l-14 14z`} className="s4" />
      <rect x={x} y={y} width={w} height="16" rx="3" className="s3" />
      <rect x={x} y={y} width={w} height="5" rx="2.5" className="s2" />
    </g>
  );
}

function Ladle({ x }: { x: number }) {
  return (
    <g className="utensil">
      <rect x={x - 3} y="66" width="6" height="150" rx="3" className="s2" />
      <circle cx={x} cy="238" r="27" className="s3" />
      <circle cx={x} cy="238" r="21" className="s2" />
      <circle cx={x - 7} cy="231" r="5" className="s1" />
    </g>
  );
}

function Spatula({ x }: { x: number }) {
  return (
    <g className="utensil">
      <rect x={x - 3} y="66" width="6" height="110" rx="3" className="s2" />
      <rect x={x - 19} y="172" width="38" height="66" rx="7" className="s3" />
      <rect x={x - 12} y="180" width="6" height="50" rx="3" className="s2" />
      <rect x={x + 2} y="180" width="6" height="50" rx="3" className="s2" />
    </g>
  );
}

function Pan({ x }: { x: number }) {
  return (
    <g className="utensil">
      <rect x={x - 3} y="66" width="6" height="64" rx="3" className="s2" />
      <circle cx={x} cy="186" r="48" className="s4" />
      <circle cx={x} cy="186" r="40" className="s3" />
      <circle cx={x - 12} cy="173" r="8" className="s2" />
    </g>
  );
}

function Rail({ children }: { children: ReactNode }) {
  return (
    <g className="rail">
      <rect x="36" y="64" width="488" height="9" rx="4.5" className="cast" />
      <rect x="30" y="60" width="500" height="8" rx="4" className="s3" />
      <rect x="30" y="60" width="500" height="3" rx="1.5" className="s2" />
      <rect x="36" y="60" width="10" height="20" rx="3" className="s4" />
      <rect x="514" y="60" width="10" height="20" rx="3" className="s4" />
      {children}
    </g>
  );
}

/** The hero's picture: a rail of utensils over a shelf that holds a carrier, a pot, bowls and a jar. */
export function HeroScene() {
  return (
    <svg
      className="hero-scene"
      viewBox={`0 0 ${HERO.width} ${HERO.height}`}
      preserveAspectRatio="xMaxYMax meet"
      aria-hidden="true"
      focusable="false"
    >
      <Rail>
        <Ladle x={100} />
        <Spatula x={178} />
        <Pan x={506} />
      </Rail>
      <Shelf x={20} y={440} w={520} />
      <g className="things">
        <g className="bowls">
          <path d="M44 440l8-30h104l8 30z" className="s2" />
          <path d="M52 410l7-26h90l7 26z" className="s3" />
          <path d="M60 384l6-22h76l6 22z" className="s2" />
          <rect x="44" y="436" width="120" height="4" className="s4" />
        </g>
        <g className="jar">
          <rect x="190" y="390" width="46" height="50" rx="9" className="jar-body" />
          <rect x="190" y="378" width="46" height="16" rx="5" className="s3" />
          <rect x="196" y="396" width="8" height="34" rx="4" className="jar-shine" />
        </g>
        <g className="pot">
          <Steam vent={POT_VENT} />
          <rect x="462" y="380" width="78" height="60" rx="9" className="s3" />
          <rect x="454" y="392" width="12" height="9" rx="4" className="s4" />
          <rect x="536" y="392" width="12" height="9" rx="4" className="s4" />
          <rect x="458" y="368" width="86" height="16" rx="8" className="s2" />
          <rect x="492" y="358" width="18" height="12" rx="5" className="s4" />
          <rect x="470" y="388" width="8" height="46" rx="4" className="s2" />
        </g>
      </g>
      <g className="hero-carrier" transform={`translate(${HERO.carrierAt.x} ${HERO.carrierAt.y})`}>
        <Steam vent={CARRIER_VENT} />
        <Carrier />
      </g>
    </svg>
  );
}

/* ---- The stage that tells the move: three places, one carrier that travels between them. ---- */

export const STATIONS = [
  { name: 'Our shared shelf', x: 0 },
  { name: 'A shelf of your own', x: 400 },
  { name: 'A kitchen of your own', x: 800 },
] as const;

/** Where the traveller stands at each station. */
export const POSES = [
  { x: 178, y: 330, s: 0.34 },
  { x: 538, y: 213, s: 0.62 },
  { x: 930, y: 265, s: 0.62 },
] as const;

/**
 * Where the traveller stands, as an SVG transform, at a place along its way: a whole number is a station, and
 * a number between two is between them.
 */
export const poseAt = (p: number) => {
  const i = Math.min(POSES.length - 2, Math.max(0, Math.floor(p)));
  const f = Math.min(1, Math.max(0, p - i));
  const a = POSES[i]!;
  const b = POSES[i + 1]!;
  const mix = (m: number, n: number) => Math.round((m + (n - m) * f) * 100) / 100;
  return `translate(${mix(a.x, b.x)}px, ${mix(a.y, b.y)}px) scale(${mix(a.s, b.s)})`;
};

function Row({ y, skip }: { y: number; skip?: number }) {
  return (
    <>
      <Shelf x={20} y={y} w={360} />
      {[0, 1, 2, 3, 4].map((i) =>
        i === skip ? null : (
          <g key={i} transform={`translate(${34 + i * 72} ${y - 104}) scale(0.34)`}>
            <Carrier clip="plain" />
          </g>
        ),
      )}
    </>
  );
}

function Key({ x, y }: { x: number; y: number }) {
  return (
    <g className="key">
      <rect x={x - 22} y={y - 6} width="44" height="12" rx="6" className="s4" />
      <circle cx={x} cy={y + 34} r="15" className="key-metal" />
      <circle cx={x} cy={y + 34} r="6" className="hole" />
      <rect x={x - 4} y={y + 46} width="8" height="46" rx="3" className="key-metal" />
      <rect x={x + 4} y={y + 70} width="12" height="7" className="key-metal" />
      <rect x={x + 4} y={y + 82} width="9" height="7" className="key-metal" />
      <rect x={x - 1.5} y={y} width="3" height="20" className="s3" />
    </g>
  );
}

function Burner({ x }: { x: number }) {
  return (
    <g className="burner">
      <rect x={x} y="404" width="92" height="52" rx="8" className="s3" />
      <rect x={x - 8} y="396" width="108" height="14" rx="7" className="s2" />
      <rect x={x + 34} y="384" width="24" height="14" rx="5" className="s4" />
      <rect x={x - 14} y="414" width="14" height="9" rx="4" className="s4" />
      <rect x={x + 92} y="414" width="14" height="9" rx="4" className="s4" />
    </g>
  );
}

/**
 * Three wall panels side by side. `step` is the station the traveller is at; the traveller itself is
 * not here, it is added by the page so it can be moved.
 */
export function StageWorld() {
  return (
    <g className="world">
      <rect width="1200" height="560" fill="url(#tiles)" className="wall" />
      {/* the shared shelf */}
      <Row y={254} />
      <Row y={434} skip={2} />
      {/* a shelf of your own */}
      <Shelf x={450} y={404} w={300} />
      <Key x={716} y={188} />
      {/* a kitchen of your own */}
      <path d="M860 36h260l24 78H836z" className="s3" />
      <path d="M860 36h260l6 20H854z" className="s2" />
      <rect x="980" y="0" width="20" height="40" className="s4" />
      <Burner x={822} />
      <Burner x={1072} />
      <g className="counter">
        <rect x="806" y="456" width="394" height="104" className="s2" />
        <rect x="806" y="456" width="394" height="12" className="s1" />
        <rect x="806" y="468" width="394" height="6" className="s3" />
        <rect x="836" y="490" width="140" height="50" rx="6" className="s3" />
        <rect x="1010" y="490" width="140" height="50" rx="6" className="s3" />
      </g>
      {/* the pillars between the three places */}
      <rect x="394" y="0" width="12" height="560" className="s4" />
      <rect x="794" y="0" width="12" height="560" className="s4" />
    </g>
  );
}
