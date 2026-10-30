import { useLayoutEffect, useRef } from 'react';
import { CARRIER_BOX, Carrier } from './art.tsx';
import { carried, journeyAt, STILL, type Box, type Courier, type Hand } from './dock.ts';
import { useMedia } from './motion.tsx';

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

/** The nearest thing above an element that holds it in place as the page scrolls (`position: sticky`), if any. */
const holderOf = (el: Element): Element | null => {
  for (let up = el.parentElement; up; up = up.parentElement) {
    const style = getComputedStyle(up);
    // (An element with no box of its own, as on a phone, holds nothing.)
    if (style.position === 'sticky' && style.display !== 'contents') return up;
  }
  return null;
};

/**
 * Where a heading is in the page's flow: where it would be if nothing held it in place. A heading that the page holds
 * (the Moving stage's) is not where the reader first meets it, and the carrier stands where it is met.
 */
const inFlow = (heading: Element, holder: Element | null): Box => {
  const box = boxOf(heading);
  if (!holder?.parentElement) return box;
  const parent = holder.parentElement;
  const rest = boxOf(parent).top + parseFloat(getComputedStyle(parent).paddingTop);
  return { ...box, top: box.top - (boxOf(holder).top - rest) };
};

/**
 * The carrier on its journey through the page (the arithmetic is in `dock.ts`): off the first screen's shelf, onto
 * each chapter's heading in turn, and into the bar between. It is a copy of the carrier that takes the original's place
 * the moment the page starts to move, and while the page is moving it is drawn from the scroll alone. When the page
 * stops it is never left in the air: it eases on to the rest it was nearer, and lets go of that when the page moves
 * again. With no way to move it (reduced motion), the shelf keeps its carrier and the bar its mark.
 *
 * `chapters` are the ids of the sections, in order, whose headings (`<id>-title`) it stands on.
 */
export function Dock({ chapters }: { chapters: readonly string[] }) {
  const flyer = useRef<SVGSVGElement>(null);
  const reduce = useMedia('(prefers-reduced-motion: reduce)');

  // Before the first paint, so the bar's mark is never seen for a moment where the carrier is still on its shelf.
  useLayoutEffect(() => {
    const fly = flyer.current;
    // The page it is drawn in: it is the first thing in it, and a child's layout effect runs before its parent's ref is set.
    const home = fly?.parentElement;
    if (!home || !fly || reduce) return;
    const scene = home.querySelector('.hero-scene');
    const mark = home.querySelector<SVGSVGElement>('.hnav .mark');
    const hero = home.querySelector<HTMLElement>('.hero');
    if (!scene || !mark || !hero) return;
    // What each chapter's heading is held by, which changes only with the screen's shape.
    const find = () =>
      chapters.map((id) => {
        const el = document.getElementById(`${id}-title`);
        return el ? { el, holder: holderOf(el) } : null;
      });
    let headings = find();
    let raf = 0;
    let timer = 0;
    // When the page last moved, when the last frame was, and how far the carrier is from where the page says.
    let moved = -Infinity;
    let before = 0;
    let hand: Hand = { gap: 0, speed: 0 };

    const draw = (d: Courier, at: number) => {
      fly.dataset.at = String(Math.round(at * 1000) / 1000);
      fly.style.opacity = String(Math.round(d.flyer * 1000) / 1000);
      fly.style.transform = `translate(${d.box.left.toFixed(2)}px, ${d.box.top.toFixed(2)}px) scale(${(d.box.width / CARRIER_BOX.width).toFixed(4)}, ${(d.box.height / CARRIER_BOX.height).toFixed(4)})`;
      mark.style.opacity = String(Math.round(d.mark * 1000) / 1000);
      hero.dataset.lifted = String(d.lifted);
      mark.classList.toggle('is-docked', d.docked);
    };
    const journey = () =>
      journeyAt({
        scene: boxOf(scene),
        mark: boxOf(mark),
        headings: headings.map((h) => (h ? inFlow(h.el, h.holder) : null)),
        scrollY: window.scrollY,
        vh: window.innerHeight,
      });

    const place = (now: number) => {
      raf = 0;
      const trip = journey();
      const still = now - moved >= STILL;
      const step = carried(
        hand,
        trip.progress,
        still,
        before ? Math.min((now - before) / 1000, 0.05) : 1 / 60,
      );
      hand = step;
      // (On a rest, exactly: a sum of two fractions might miss it by a hair.)
      const shown = step.done && still ? Math.round(trip.progress) : trip.progress + hand.gap;
      draw(trip.courier(shown), shown);
      before = step.done ? 0 : now;
      if (!step.done) raf = requestAnimationFrame(place);
    };
    const soon = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };
    // The page has moved: the carrier follows it, and is put down if the page does not move again for a moment.
    const scrolled = () => {
      moved = performance.now();
      clearTimeout(timer);
      timer = window.setTimeout(soon, STILL + 20);
      soon();
    };

    // A page opened part-way down starts with the carrier at a rest, and not on its way to one.
    {
      const trip = journey();
      hand = { gap: Math.round(trip.progress) - trip.progress, speed: 0 };
      draw(trip.courier(Math.round(trip.progress)), Math.round(trip.progress));
    }
    window.addEventListener('scroll', scrolled, { passive: true });
    const reshaped = () => {
      headings = find();
      soon();
    };
    window.addEventListener('resize', reshaped);
    // Fonts and pictures settling move things without a scroll.
    const watch = new ResizeObserver(soon);
    watch.observe(hero);
    return () => {
      window.removeEventListener('scroll', scrolled);
      window.removeEventListener('resize', reshaped);
      watch.disconnect();
      clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
      delete fly.dataset.at;
      fly.style.opacity = '';
      fly.style.transform = '';
      mark.style.opacity = '';
      mark.classList.remove('is-docked');
      delete hero.dataset.lifted;
    };
  }, [reduce, chapters]);

  return (
    <svg
      className="flyer"
      ref={flyer}
      viewBox={`${CARRIER_BOX.x} ${CARRIER_BOX.y} ${CARRIER_BOX.width} ${CARRIER_BOX.height}`}
      width={CARRIER_BOX.width}
      height={CARRIER_BOX.height}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <Carrier clip="mine" />
    </svg>
  );
}
