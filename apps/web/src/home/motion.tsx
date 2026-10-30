import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useState,
  type ElementType,
  type RefObject,
} from 'react';

/** Whether a media query matches, kept current. False until the browser says otherwise. */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const set = () => setOn(mq.matches);
    set();
    mq.addEventListener('change', set);
    return () => mq.removeEventListener('change', set);
  }, [query]);
  return on;
}

/**
 * Lets the parts of the page below the first screen arrive as they are reached: once, never again.
 *
 * Nothing is hidden until this has run and found it can show them again: with reduced motion, or
 * without IntersectionObserver, the class that hides them is never added and the page is simply
 * there. Everything marked `data-reveal` gets `is-in` when it comes into view.
 */
export function useReveal(root: RefObject<HTMLElement | null>) {
  // Before the first paint, so nothing below the fold is seen at rest and then hidden.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const targets = [...el.querySelectorAll<HTMLElement>('[data-reveal]')];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
    );
    el.classList.add('reveal-on');
    for (const t of targets) io.observe(t);
    return () => {
      io.disconnect();
      el.classList.remove('reveal-on');
      for (const t of targets) t.classList.remove('is-in');
    };
  }, [root]);
}

/**
 * A heading whose lines are set by hand. Each line rises from behind its own baseline, one after the
 * other, when the heading arrives. The words are one run of text to anything that reads it.
 */
export function Lines({
  as: Tag = 'h2',
  lines,
  className,
  id,
  first = false,
}: {
  as?: ElementType;
  lines: string[];
  className?: string;
  id?: string;
  /** On the first screen: the lines rise as the page loads, not when scrolled to. */
  first?: boolean;
}) {
  return (
    <Tag
      className={`lines${className ? ` ${className}` : ''}`}
      id={id}
      data-reveal={first ? undefined : 'lines'}
      data-first={first ? '' : undefined}
    >
      {lines.map((line, i) => (
        <Fragment key={line}>
          <span className="line">
            <span className="line-in" style={{ ['--i' as string]: i }}>
              {line}
            </span>
          </span>{' '}
        </Fragment>
      ))}
    </Tag>
  );
}

/**
 * A figure whose digits roll up to their value once, a beat apart, when it arrives. The number is
 * real text for anything that reads it; the rolling columns are only for the eye.
 */
export function Figure({ value }: { value: string }) {
  let n = 0;
  return (
    <span className="roll" data-reveal="roll">
      <span className="sr">{value}</span>
      <span className="roll-digits" aria-hidden="true">
        {[...value].map((ch, k) =>
          /\d/.test(ch) ? (
            <span className="roll-col" key={k}>
              <span
                className="roll-strip"
                style={{ ['--d' as string]: ch, ['--i' as string]: n++ }}
              >
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </span>
            </span>
          ) : (
            <span key={k}>{ch}</span>
          ),
        )}
      </span>
    </span>
  );
}

/**
 * Says whether a part of the page is in view and the tab is showing it, as `data-live` on it, so that what
 * moves on its own (steam, for instance) can stop when nobody could see it.
 */
export function useLive(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let inView = typeof IntersectionObserver === 'undefined';
    const show = () => {
      el.dataset.live = String(inView && !document.hidden);
    };
    const io =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver((entries) => {
            inView = entries.some((e) => e.isIntersecting);
            show();
          });
    io?.observe(el);
    document.addEventListener('visibilitychange', show);
    show();
    return () => {
      io?.disconnect();
      document.removeEventListener('visibilitychange', show);
      delete el.dataset.live;
    };
  }, [root]);
}

/**
 * A light that follows the pointer across `target` while the pointer is over `area`, and wanders along it,
 * slowly, when nobody is pointing. The stylesheet draws it from two custom properties on `target`, `--lx` and
 * `--ly` (percentages of its box); this only moves them. It runs only while `area` is in view and the tab is
 * showing, and with reduced motion it does not wander: the light rests in the middle and still follows a pointer,
 * which is the person's own movement.
 */
export function useLight(
  area: RefObject<HTMLElement | null>,
  target: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const root = area.current;
    const el = target.current;
    if (!root || !el || typeof IntersectionObserver === 'undefined') return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const REST = { x: 50, y: 58 };
    let at = { ...REST };
    let pointer: { x: number; y: number } | null = null;
    let raf = 0;
    let inView = false;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

    const frame = (t: number) => {
      raf = 0;
      const s = t / 1000;
      const goal =
        pointer ??
        (reduced.matches
          ? REST
          : { x: 50 + 34 * Math.sin(s * 0.21), y: 58 + 8 * Math.sin(s * 0.13 + 1) });
      // Quick to follow a hand, lazy about its own wandering.
      const k = reduced.matches ? 1 : pointer ? 0.16 : 0.04;
      at = { x: at.x + (goal.x - at.x) * k, y: at.y + (goal.y - at.y) * k };
      el.style.setProperty('--lx', `${at.x.toFixed(1)}%`);
      el.style.setProperty('--ly', `${at.y.toFixed(1)}%`);
      const settled = Math.abs(goal.x - at.x) < 0.05 && Math.abs(goal.y - at.y) < 0.05;
      if (inView && !document.hidden && !(reduced.matches && !pointer && settled)) run();
    };
    const run = () => {
      if (!raf && inView && !document.hidden) raf = requestAnimationFrame(frame);
    };

    // A theme that is dissolving puts a picture of the page between the pointer and the page for as long as it lasts
    // (see theme.js): the pointer has not left, and it is not reading anything either, so nothing is taken from it.
    const html = document.documentElement;
    const dissolving = () => html.classList.contains('theme-fading');
    const release = () => {
      if (!pointer) return;
      pointer = null;
      run();
    };
    // Heard on the window, so a pointer that went out while the page was held (and so never said so) is let go of the
    // next time it moves.
    const move = (e: PointerEvent) => {
      if (dissolving()) return;
      if (!(e.target instanceof Node && root.contains(e.target))) {
        release();
        return;
      }
      const r = el.getBoundingClientRect();
      pointer = {
        x: clamp(((e.clientX - r.left) / r.width) * 100, -5, 105),
        y: clamp(((e.clientY - r.top) / r.height) * 100, -10, 110),
      };
      run();
    };
    const leave = () => {
      if (!dissolving()) release();
    };
    const io = new IntersectionObserver((entries) => {
      inView = entries.some((e) => e.isIntersecting);
      if (inView) run();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    });
    io.observe(root);
    window.addEventListener('pointermove', move, { passive: true });
    root.addEventListener('pointerleave', leave);
    document.addEventListener('visibilitychange', run);
    reduced.addEventListener('change', run);
    return () => {
      io.disconnect();
      window.removeEventListener('pointermove', move);
      root.removeEventListener('pointerleave', leave);
      document.removeEventListener('visibilitychange', run);
      reduced.removeEventListener('change', run);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [area, target]);
}

/**
 * One step of a critically damped spring: from `x` toward `goal` with velocity `v`, over `dt` seconds, taking about
 * three times `smooth` to arrive. It starts and ends gently, never passes the goal, and when the goal moves
 * in mid-flight (a page scrolled back and forth) both position and velocity carry on unbroken, which a
 * timed animation that is cancelled and restarted cannot do.
 */
export function smoothDamp(
  x: number,
  goal: number,
  v: number,
  smooth: number,
  dt: number,
): [x: number, v: number] {
  const w = 2 / smooth;
  const k = w * dt;
  const decay = 1 / (1 + k + 0.48 * k * k + 0.235 * k * k * k);
  const d = x - goal;
  const t = (v + w * d) * dt;
  const next = goal + (d + t) * decay;
  // The spring is exact; the polynomial above is not, so it is not allowed to cross the goal.
  if (x < goal === next > goal) return [goal, 0];
  return [next, (v - w * t) * decay];
}

/**
 * The section the reader is in: the last of `ids`, in page order, whose top has passed 40% of the way down the
 * screen; none while the first has not been reached. Read from where the page is, on each frame of a scroll, so the
 * answer is right however fast the page was moved.
 */
export function useChapter(ids: readonly string[]): string | null {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const line = window.innerHeight * 0.4;
      let found: string | null = null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) found = id;
      }
      setNow(found);
    };
    const soon = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', soon, { passive: true });
    window.addEventListener('resize', soon);
    return () => {
      window.removeEventListener('scroll', soon);
      window.removeEventListener('resize', soon);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ids]);
  return now;
}
