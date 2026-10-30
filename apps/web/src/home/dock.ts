import { MARK_BOX } from '../components/Mark.tsx';
import { CARRIER_BOX, HERO } from './art.tsx';
import { smoothDamp } from './motion.tsx';

/**
 * One carrier goes through the whole page. It is lifted off the first screen's shelf and carried to the first
 * chapter's heading, where it stands for as long as the heading is read; as the heading leaves the top of the screen
 * it is put into the bar, where it is the tiffin that is packed as the page is read; and when the next chapter's
 * heading comes up it is taken out of the bar again and carried down to stand on that.
 *
 * The journey is a line of rests (the shelf, the first heading, the bar, the next heading, the bar, and so on) and a
 * number, how far along that line the carrier is: a whole number is a rest, and anywhere between two it is in the
 * air. The page's scroll gives that number and nothing else does, so wherever the page says the carrier is, scrolled
 * hard or slowly, forward or back, that is where it is. The page does not always say a rest, though, and a carrier
 * is never left in the air: when the page has stopped, `carried` brings it the rest of the way to the rest it is
 * nearer, as a hand would.
 */

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Courier {
  /** Where the carrier is on the screen, and how much of it is seen. */
  box: Box;
  flyer: number;
  /** How much of the bar's mark is seen: all of it when the carrier is in it, a ghost of it when the carrier is out. */
  mark: number;
  /** The shelf's own carrier is away. */
  lifted: boolean;
  /** The carrier is in the bar. */
  docked: boolean;
}

/** How much of the mark is seen while the carrier is out of it: enough to show where it will go. */
const GHOST = 0.28;
/** The carrier standing on a heading: how tall, and how far above the heading's top edge it stands. */
const STAND = { height: 60, above: 14 };

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** The part of a trip, from 0 to 1, from `from` to `to`. */
const between = (x: number, from: number, to: number) => smooth(clamp((x - from) / (to - from)));

/** Where the hero's carrier stands on the screen, given where the hero's picture is. */
export function carrierIn(scene: Box): Box {
  // The picture is fitted to its frame and set against its foot and its right edge (`xMaxYMax meet`).
  const k = Math.min(scene.width / HERO.width, scene.height / HERO.height);
  const left = scene.left + scene.width - HERO.width * k;
  const top = scene.top + scene.height - HERO.height * k;
  return {
    left: left + (HERO.carrierAt.x + CARRIER_BOX.x) * k,
    top: top + (HERO.carrierAt.y + CARRIER_BOX.y) * k,
    width: CARRIER_BOX.width * k,
    height: CARRIER_BOX.height * k,
  };
}

/** Where the tiffin stands on the screen, given where the bar's mark is. */
export function tiffinIn(mark: Box): Box {
  const u = mark.width / MARK_BOX.size;
  const v = mark.height / MARK_BOX.size;
  return {
    left: mark.left + MARK_BOX.x * u,
    top: mark.top + MARK_BOX.y * v,
    width: MARK_BOX.width * u,
    height: MARK_BOX.height * v,
  };
}

/** Where the carrier stands on a heading: on its top edge, at its left. */
export function standOn(heading: Box): Box {
  const width = (STAND.height * CARRIER_BOX.width) / CARRIER_BOX.height;
  return {
    left: heading.left,
    top: heading.top - STAND.above - STAND.height,
    width,
    height: STAND.height,
  };
}

/** Where the carrier is a part `e` of the way from one place to another: carried, not slid. */
function carry(from: Box, to: Box, e: number, vh: number): Box {
  // Smaller by the same share each step, so it does not seem to slow as it shrinks.
  const size = (a: number, b: number) => a * (b / a) ** e;
  const width = size(from.width, to.width);
  const height = size(from.height, to.height);
  // A little lift on the way.
  const lift = Math.sin(Math.PI * e) * vh * 0.04;
  const cx = lerp(from.left + from.width / 2, to.left + to.width / 2, e);
  const cy = lerp(from.top + from.height / 2, to.top + to.height / 2, e) - lift;
  return { left: cx - width / 2, top: cy - height / 2, width, height };
}

const mix = (a: Box, b: Box, t: number): Box => ({
  left: lerp(a.left, b.left, t),
  top: lerp(a.top, b.top, t),
  width: lerp(a.width, b.width, t),
  height: lerp(a.height, b.height, t),
});

export interface Where {
  /** The hero's picture, the bar's mark, and each chapter's heading (or null if it is not there), on the screen now. */
  scene: Box;
  mark: Box;
  headings: (Box | null)[];
  scrollY: number;
  vh: number;
}

export interface Journey {
  /** How far along the line of rests the page has taken the carrier: 0 on the shelf, 1 on the first heading, 2 in the bar, and so on. */
  progress: number;
  /** The carrier at any point along that line (the page's own, or one the carrier has been brought to). */
  courier: (at: number) => Courier;
}

/**
 * Where the carrier is, and where on its journey that is.
 *
 * It lets go of the shelf when it has come up the screen to a line in the upper part of it, which for a tall first
 * screen is at once, and for a phone, where it starts below the words, is when it has come into view; it then
 * crosses to the first heading over about a third of a screen of scrolling. A heading's carrier is put into the bar over
 * the next stretch, as the heading comes to the top, and the next heading's is taken out of it as that heading comes
 * up from the foot of the screen.
 */
export function journeyAt({ scene, mark, headings, scrollY, vh }: Where): Journey {
  const nav = tiffinIn(mark);
  const stops = headings.flatMap((heading) =>
    heading ? [{ heading, stand: standOn(heading) }] : [],
  );
  const rest = carrierIn(scene);
  const onPage = rest.top + rest.height / 2 + scrollY;
  const line = Math.min(onPage, vh * 0.62);
  const run = clamp(vh * 0.36, 200, 360);
  const p = clamp((scrollY - (onPage - line)) / run);
  const dockLine = vh * 0.2;
  // With no headings the carrier goes from the shelf straight to the bar.
  const last = stops.length ? stops.length * 2 : 1;
  // Where the carrier lets go of the shelf: the place it stood when the page got to the line.
  const from: Box = { ...rest, top: line - rest.height / 2 };

  const progress = (): number => {
    if (p < 1) return p;
    for (const [i, { heading, stand }] of stops.entries()) {
      // Put into the bar as the heading it stands on goes up past a line near the top of the screen. Each chapter
      // finishes with the carrier before the next takes it, so it is only ever in one place.
      const d = clamp((dockLine - stand.top) / (dockLine - nav.top));
      if (d >= 1) continue;
      if (d > 0) return 2 * i + 1 + d;
      // Taken out of the bar as the heading comes up from the foot of the screen. The first heading's carrier has
      // already been carried to it from the shelf.
      return 2 * i + (i === 0 ? 1 : clamp((vh * 0.92 - heading.top) / (vh * 0.34)));
    }
    return last;
  };

  const courier = (at: number): Courier => {
    const j = clamp(at, 0, last);
    if (j >= last) return { box: nav, flyer: 0, mark: 1, lifted: true, docked: true };
    const leg = Math.floor(j);
    const t = j - leg;

    if (leg === 0) {
      // Off the shelf and on its way to the first chapter (or, with no chapters, to the bar). As it lets go it is
      // where the shelf's carrier is now, which is where the page has left it if the page is not the one moving it.
      const e = smooth(t);
      const toBar = !stops.length;
      const home = mix(rest, from, between(t, 0, 0.15));
      return {
        box: carry(home, stops[0]?.stand ?? nav, e, vh),
        flyer: t <= 0 ? 0 : toBar ? 1 - between(e, 0.8, 1) : 1,
        mark: toBar ? lerp(GHOST, 1, between(e, 0.8, 1)) : GHOST,
        lifted: t > 0,
        docked: false,
      };
    }
    if (leg % 2 === 1) {
      // Standing on a heading, and put into the bar.
      const { stand } = stops[(leg - 1) / 2]!;
      return {
        box: carry(stand, nav, smooth(t), vh),
        flyer: 1 - between(t, 0.85, 1),
        mark: lerp(GHOST, 1, between(t, 0.85, 1)),
        lifted: true,
        docked: false,
      };
    }
    // In the bar, and taken out and carried down to the next heading.
    const { stand } = stops[leg / 2]!;
    const out = between(t, 0, 0.15);
    return {
      box: carry(nav, stand, smooth(t), vh),
      flyer: out,
      mark: lerp(1, GHOST, out),
      lifted: true,
      docked: t === 0,
    };
  };

  return { progress: progress(), courier };
}

/** Where the carrier is, as the page says. */
export function courierAt(where: Where): Courier {
  const { progress, courier } = journeyAt(where);
  return courier(progress);
}

/** How long the page must have stood still, in milliseconds, before the carrier is brought to a rest. */
export const STILL = 140;
/** How quickly the carrier follows the page when it is being moved again, and how gently it comes to a rest (spring times, in seconds). */
const FOLLOW = 0.14;
const SETTLE = 0.2;

/** How far the carrier is from where the page says, along the journey, and how fast that is closing. */
export interface Hand {
  gap: number;
  speed: number;
}

/**
 * One step of the carrier's hand, `dt` seconds long, for a page that says the carrier is `at` along its journey.
 *
 * While the page is moving, the carrier is where the page says, and anything that was left between them (a carrier
 * brought to a rest, and the page then moved again) is let go of over a moment, so it is never pulled. When the page
 * has stopped, the carrier goes on to the whole number nearest to where the page left it: the rest it was leaving,
 * if it was less than half way, and the one it was going to if it was more. It starts without a jolt, and it ends
 * gently, on the rest itself. `done` is when there is nothing more to move.
 */
export function carried(
  hand: Hand,
  at: number,
  still: boolean,
  dt: number,
): Hand & { done: boolean } {
  const goal = still ? Math.round(at) - at : 0;
  const [gap, speed] = smoothDamp(hand.gap, goal, hand.speed, still ? SETTLE : FOLLOW, dt);
  if (Math.abs(gap - goal) < 0.0005 && Math.abs(speed) < 0.005)
    return { gap: goal, speed: 0, done: true };
  return { gap, speed, done: false };
}
