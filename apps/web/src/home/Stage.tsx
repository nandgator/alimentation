import { useLayoutEffect, useRef, useState } from 'react';
import { Carrier, STATIONS, StageWorld, poseAt } from './art.tsx';
import { Lines, smoothDamp, useLive, useMedia } from './motion.tsx';
import { CARRIER_VENT, Steam } from './steam.tsx';

/** About a third of the time the carrier takes to cross from one place to the next. */
const SMOOTH = 0.3;
const LIFT = 84;

/**
 * The three places a kitchen can live, told by one carrier that is lifted from place to place.
 *
 * Where the carrier is, is one number, `p`: 0, 1 or 2 at a place, and between two while it is on its way. The page
 * only says which place it should be at (the one whose words are nearest the middle of the screen); a spring
 * carries `p` there, and every frame draws the carrier, its lift and the camera from `p` alone. So a page scrolled
 * hard back and forth, which changes the place many times a second, makes the carrier turn about smoothly in the
 * air, where a timed hop that is cancelled and restarted would snap it back to where it last landed.
 */
export function Stage() {
  const [step, setStep] = useState(0);
  const narrow = useMedia('(max-width: 799px)');
  const reduce = useMedia('(prefers-reduced-motion: reduce)');
  const root = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const camera = useRef<SVGGElement>(null);
  const mover = useRef<SVGGElement>(null);
  const lifter = useRef<SVGGElement>(null);
  const flight = useRef({ p: 0, v: 0, goal: 0, placed: false });
  useLive(root);

  useLayoutEffect(() => {
    const top = root.current;
    const cam = camera.current;
    const ride = mover.current;
    const lift = lifter.current;
    const items = itemRefs.current.filter((x): x is HTMLLIElement => x !== null);
    if (!top || !cam || !ride || !lift) return;
    const f = flight.current;
    let raf = 0;
    let pick = 0;
    let last = 0;

    const draw = () => {
      ride.style.transform = poseAt(f.p);
      lift.style.transform = `translateY(${(-LIFT * Math.sin(Math.PI * (f.p - Math.floor(f.p)))).toFixed(2)}px)`;
      cam.style.transform = narrow ? `translateX(${(-f.p * 400).toFixed(2)}px)` : 'none';
    };
    const frame = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      if (reduce) [f.p, f.v] = [f.goal, 0];
      else [f.p, f.v] = smoothDamp(f.p, f.goal, f.v, SMOOTH, dt);
      const still = Math.abs(f.p - f.goal) < 0.0005 && Math.abs(f.v) < 0.0005;
      if (still) [f.p, f.v] = [f.goal, 0];
      draw();
      top.dataset.hop = String(!still);
      if (!still) raf = requestAnimationFrame(frame);
    };
    const wake = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    // The step whose words are nearest the middle of the screen. Read from where the page is, not from what
    // crosses a line, so a scroll fast enough to leap the line cannot skip a step.
    const choose = () => {
      pick = 0;
      const mid = window.innerHeight / 2;
      let best = 0;
      let gap = Infinity;
      items.forEach((it, i) => {
        const r = it.getBoundingClientRect();
        const d = Math.abs((r.top + r.bottom) / 2 - mid);
        if (d < gap) [best, gap] = [i, d];
      });
      if (best === f.goal && f.placed) return;
      f.goal = best;
      setStep(best);
      if (!f.placed) {
        // The first time, the carrier is simply there, as the page found it.
        f.placed = true;
        [f.p, f.v] = [best, 0];
        draw();
      } else wake();
    };
    const soon = () => {
      if (!pick) pick = requestAnimationFrame(choose);
    };

    choose();
    draw();
    // A change of screen (a phone turned, motion reduced) redraws where the carrier is.
    if (f.p !== f.goal) wake();
    window.addEventListener('scroll', soon, { passive: true });
    window.addEventListener('resize', soon);
    return () => {
      window.removeEventListener('scroll', soon);
      window.removeEventListener('resize', soon);
      if (raf) cancelAnimationFrame(raf);
      if (pick) cancelAnimationFrame(pick);
      delete top.dataset.hop;
    };
  }, [narrow, reduce]);

  const view = narrow ? '0 130 400 400' : '0 0 1200 560';

  return (
    <div className="moving hwrap" data-step={step} ref={root}>
      <div className="stage-col">
        <Lines lines={['Start on our shelf.', 'Move when you’re ready.']} id="moving-title" />
        <div className="stage-wrap">
          <svg
            className="stage"
            viewBox={view}
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
            focusable="false"
          >
            <g ref={camera}>
              <StageWorld />
              <g ref={mover} className="mover">
                <g ref={lifter}>
                  <Steam vent={CARRIER_VENT} />
                  <Carrier clip="mine" />
                </g>
              </g>
            </g>
          </svg>
        </div>
      </div>
      <ol className="steps" aria-labelledby="moving-title">
        <li ref={(n) => void (itemRefs.current[0] = n)} className={step === 0 ? 'on' : ''}>
          <h3>{STATIONS[0].name}</h3>
          <p>
            Free while you are small. Your kitchen gets a book of its own, kept apart from every
            other kitchen’s, so a busy neighbour never slows you down.
          </p>
        </li>
        <li ref={(n) => void (itemRefs.current[1] = n)} className={step === 1 ? 'on' : ''}>
          <h3>{STATIONS[1].name}</h3>
          <p>
            Outgrown free? One tap moves everything to storage you hold, and we keep serving it. You
            keep the key.
          </p>
          <p>
            First we practise the move, then recount every bill to the paisa, and only then switch.
            Your old copy stays readable for seven days, then it is wiped.
          </p>
          <p className="catch">
            <b>The catch.</b> It needs somewhere to go: empty storage from any database provider, or
            your own copy of Alimentation.
          </p>
        </li>
        <li ref={(n) => void (itemRefs.current[2] = n)} className={step === 2 ? 'on' : ''}>
          <h3>{STATIONS[2].name}</h3>
          <p>
            Run all of it on a computer you control. One command starts it, and moving there is the
            same single tap, with the same checks.
          </p>
        </li>
      </ol>
    </div>
  );
}
