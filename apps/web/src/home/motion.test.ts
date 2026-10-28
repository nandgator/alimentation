import { describe, expect, it } from 'vitest';
import { smoothDamp } from './motion.tsx';

/** Runs the follower at 60 frames a second, with the goal as a function of time, and returns every frame. */
function run(goal: (t: number) => number, seconds: number, from = 0, fps = 60) {
  const frames: { t: number; x: number; v: number }[] = [];
  let x = from;
  let v = 0;
  for (let i = 1; i <= seconds * fps; i++) {
    const t = i / fps;
    [x, v] = smoothDamp(x, goal(t), v, 0.3, 1 / fps);
    frames.push({ t, x, v });
  }
  return frames;
}

describe('the follower that carries the tiffin from place to place', () => {
  it('arrives, without passing the place, and is still on arrival', () => {
    const frames = run(() => 2, 3);
    expect(frames.every((f) => f.x <= 2)).toBe(true);
    expect(frames.every((f, i) => i === 0 || f.x >= frames[i - 1]!.x)).toBe(true);
    const end = frames.at(-1)!;
    expect(end.x).toBeCloseTo(2, 3);
    expect(Math.abs(end.v)).toBeLessThan(0.001);
  });

  it('takes about a second to cross a place, and starts gently', () => {
    const frames = run(() => 1, 2);
    expect(frames.find((f) => f.x > 0.99)!.t).toBeGreaterThan(0.8);
    expect(frames.find((f) => f.x > 0.99)!.t).toBeLessThan(1.4);
    // The first frame has barely moved: it does not leap off.
    expect(frames[0]!.x).toBeLessThan(0.01);
  });

  it('never jumps when the place changes in mid-flight, however often it does', () => {
    // A page scrolled hard up and down: the place flips between the ends every 0.3 seconds.
    const frames = run((t) => (Math.floor(t / 0.3) % 2 === 0 ? 2 : 0), 6, 1);
    let worstStep = 0;
    let worstTurn = 0;
    frames.forEach((f, i) => {
      if (i === 0) return;
      worstStep = Math.max(worstStep, Math.abs(f.x - frames[i - 1]!.x));
      worstTurn = Math.max(worstTurn, Math.abs(f.v - frames[i - 1]!.v));
    });
    // A whole place (1) in one frame would be a snap; the follower stays under a tenth of one.
    expect(worstStep).toBeLessThan(0.1);
    // And its speed changes by degrees, not at once.
    expect(worstTurn).toBeLessThan(1.5);
    expect(frames.every((f) => f.x >= -0.001 && f.x <= 2.001)).toBe(true);
  });

  it('copes with a long frame, as a tab that was in the background produces', () => {
    const [x, v] = smoothDamp(0, 2, 0, 0.3, 0.05);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(2);
    expect(Number.isFinite(v)).toBe(true);
  });
});
