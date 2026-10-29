import { MARK_BOX } from '../components/Mark.tsx';
import { CARRIER_BOX, HERO } from './art.tsx';

/**
 * One carrier goes through the whole page. It is lifted off the first screen's shelf and carried to the first
 * chapter's heading, where it stands for as long as the heading is read; as the heading leaves the top of the screen
 * it is put into the bar, where it is the tiffin that is packed as the page is read; and when the next chapter's
 * heading comes up it is taken out of the bar again and carried down to stand on that. This is the arithmetic of its
 * whole journey, from where a few things are on the screen and how far the page has been scrolled, so the carrier is a
 * function of the scroll and nothing else: wherever the page says it is, scrolled hard or slowly, forward or back.
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

export interface Where {
  /** The hero's picture, the bar's mark, and each chapter's heading (or null if it is not there), on the screen now. */
  scene: Box;
  mark: Box;
  headings: (Box | null)[];
  scrollY: number;
  vh: number;
}

/**
 * Where the carrier is.
 *
 * It lets go of the shelf when it has come up the screen to a line in the upper part of it, which for a tall first
 * screen is at once, and for a phone, where it starts below the words, is when it has come into view; it then
 * crosses to the first heading over about a third of a screen of scrolling. A heading's carrier is put into the bar over
 * the next stretch, as the heading comes to the top, and the next heading's is taken out of it as that heading comes
 * up from the foot of the screen.
 */
export function courierAt({ scene, mark, headings, scrollY, vh }: Where): Courier {
  const nav = tiffinIn(mark);
  const stands = headings.map((h) => (h ? standOn(h) : null));
  const rest = carrierIn(scene);
  const onPage = rest.top + rest.height / 2 + scrollY;
  const line = Math.min(onPage, vh * 0.62);
  const run = clamp(vh * 0.36, 200, 360);
  const p = clamp((scrollY - (onPage - line)) / run);
  const first = stands[0] ?? nav;

  if (p < 1) {
    // Off the shelf and on its way to the first chapter (or, with no chapters, to the bar).
    const e = smooth(p);
    const from: Box = { ...rest, top: line - rest.height / 2 };
    const toBar = first === nav;
    return {
      box: carry(from, first, e, vh),
      flyer: p <= 0 ? 0 : toBar ? 1 - between(e, 0.8, 1) : 1,
      mark: toBar ? between(e, 0.8, 1) : GHOST * between(e, 0.8, 1),
      lifted: p > 0,
      docked: false,
    };
  }

  const dockLine = vh * 0.2;
  for (let i = 0; i < stands.length; i++) {
    const stand = stands[i];
    const heading = headings[i];
    if (!stand || !heading) continue;
    // Put into the bar as the heading it stands on goes up past a line near the top of the screen. Each chapter
    // finishes with the carrier before the next takes it, so it is only ever in one place.
    const d = clamp((dockLine - stand.top) / (dockLine - nav.top));
    if (d >= 1) continue;
    if (d > 0) {
      return {
        box: carry(stand, nav, smooth(d), vh),
        flyer: 1 - between(d, 0.85, 1),
        mark: GHOST + (1 - GHOST) * between(d, 0.85, 1),
        lifted: true,
        docked: false,
      };
    }
    // Taken out of the bar as the heading comes up from the foot of the screen. The first heading's carrier has
    // already been carried to it from the shelf.
    const u = i === 0 ? 1 : clamp((vh * 0.92 - heading.top) / (vh * 0.34));
    if (u <= 0) break;
    const out = between(u, 0, 0.15);
    return {
      box: carry(nav, stand, smooth(u), vh),
      flyer: out,
      mark: 1 - (1 - GHOST) * out,
      lifted: true,
      docked: false,
    };
  }
  return { box: nav, flyer: 0, mark: 1, lifted: true, docked: true };
}
