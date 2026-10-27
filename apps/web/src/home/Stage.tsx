import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Carrier, STATIONS, StageWorld, pose } from './art.tsx';
import { Lines, useMedia } from './motion.tsx';

const HOP_MS = 1000;
const LIFT = 84;

/** The three places a kitchen can live, told by one carrier that is lifted from place to place. */
export function Stage() {
  const [step, setStep] = useState(0);
  const narrow = useMedia('(max-width: 799px)');
  const reduce = useMedia('(prefers-reduced-motion: reduce)');
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const mover = useRef<SVGGElement>(null);
  const lifter = useRef<SVGGElement>(null);
  const before = useRef(0);

  // The step whose text is at the middle of the screen is the one shown.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const items = itemRefs.current.filter((x): x is HTMLLIElement => x !== null);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) setStep(items.indexOf(e.target as HTMLLIElement));
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    for (const it of items) io.observe(it);
    return () => io.disconnect();
  }, []);

  // Lift the carrier, carry it across and set it down. The ride is one eased move; the lift is its own
  // arc, up with a slowing start and down with a quickening end, so the top of the hop is smooth.
  useLayoutEffect(() => {
    const el = mover.current;
    const up = lifter.current;
    if (!el || !up) return;
    const from = before.current;
    before.current = step;
    el.style.transform = pose(step);
    if (reduce || from === step || typeof el.animate !== 'function') return;
    const ride = el.animate([{ transform: pose(from) }, { transform: pose(step) }], {
      duration: HOP_MS,
      easing: 'cubic-bezier(0.76, 0, 0.24, 1)',
    });
    const arc = up.animate(
      [
        { transform: 'translateY(0px)', easing: 'cubic-bezier(0.33, 1, 0.68, 1)' },
        {
          transform: `translateY(${-LIFT}px)`,
          offset: 0.5,
          easing: 'cubic-bezier(0.32, 0, 0.67, 0)',
        },
        { transform: 'translateY(0px)' },
      ],
      { duration: HOP_MS },
    );
    return () => {
      ride.cancel();
      arc.cancel();
    };
  }, [step, reduce]);

  const view = narrow ? '0 130 400 400' : '0 0 1200 560';
  const world = narrow ? `translateX(${-step * 400}px)` : 'none';

  return (
    <div className="moving hwrap" data-step={step}>
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
            <g
              className="camera"
              // design: a place taken from where the page is scrolled, so it cannot be a class
              style={{ transform: world }}
            >
              <StageWorld />
              <g
                ref={mover}
                className="mover"
                // design: where the carrier starts, set once; after that the animation moves it
                style={{ transform: pose(0) }}
              >
                <g ref={lifter}>
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
