import { useLayoutEffect, useRef } from 'react';
import { CARRIER_BOX, Carrier } from './art.tsx';
import { courierAt, type Box } from './dock.ts';
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
 * the moment the page starts to move, and is drawn from the scroll alone. With no way to move it (reduced motion), the
 * shelf keeps its carrier and the bar its mark.
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

    const place = () => {
      raf = 0;
      const d = courierAt({
        scene: boxOf(scene),
        mark: boxOf(mark),
        headings: headings.map((h) => (h ? inFlow(h.el, h.holder) : null)),
        scrollY: window.scrollY,
        vh: window.innerHeight,
      });
      fly.style.opacity = String(Math.round(d.flyer * 1000) / 1000);
      fly.style.transform = `translate(${d.box.left.toFixed(2)}px, ${d.box.top.toFixed(2)}px) scale(${(d.box.width / CARRIER_BOX.width).toFixed(4)}, ${(d.box.height / CARRIER_BOX.height).toFixed(4)})`;
      mark.style.opacity = String(Math.round(d.mark * 1000) / 1000);
      hero.dataset.lifted = String(d.lifted);
      mark.classList.toggle('is-docked', d.docked);
    };
    const soon = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };

    place();
    window.addEventListener('scroll', soon, { passive: true });
    const reshaped = () => {
      headings = find();
      soon();
    };
    window.addEventListener('resize', reshaped);
    // Fonts and pictures settling move things without a scroll.
    const watch = new ResizeObserver(soon);
    watch.observe(hero);
    return () => {
      window.removeEventListener('scroll', soon);
      window.removeEventListener('resize', reshaped);
      watch.disconnect();
      if (raf) cancelAnimationFrame(raf);
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
