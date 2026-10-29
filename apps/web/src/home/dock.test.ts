import { describe, expect, it } from 'vitest';
import { carrierIn, courierAt, standOn, tiffinIn, type Box } from './dock.ts';

// The hero's picture, drawn at its own size under a bar 64 tall, a mark of 26 in the bar, and five chapters, each
// with a heading 400 wide, at these places on the page.
const SCENE: Box = { left: 0, top: 64, width: 560, height: 496 };
const MARK: Box = { left: 40, top: 19, width: 26, height: 26 };
const TOPS = [860, 1850, 2800, 3800, 4700];
const VH = 900;
const heading = (pageTop: number, y: number): Box => ({
  left: 70,
  top: pageTop - y,
  width: 400,
  height: 120,
});
const at = (y: number, tops: (number | null)[] = TOPS, scene: Box = SCENE, vh = VH) =>
  courierAt({
    scene: { ...scene, top: scene.top - y },
    mark: MARK,
    headings: tops.map((t) => (t === null ? null : heading(t, y))),
    scrollY: y,
    vh,
  });
const centre = (b: Box) => ({ x: b.left + b.width / 2, y: b.top + b.height / 2 });
const near = (a: Box, b: Box, px = 0.01) => {
  expect(a.left).toBeCloseTo(b.left, 1);
  expect(Math.abs(a.top - b.top)).toBeLessThan(px + 0.5);
  expect(a.width).toBeCloseTo(b.width, 1);
  expect(a.height).toBeCloseTo(b.height, 1);
};

describe('where the hero’s carrier is, and where the tiffin is', () => {
  it('finds the carrier inside the picture, against its foot and its right edge', () => {
    expect(carrierIn(SCENE)).toEqual({ left: 254, top: 64 + 138, width: 192, height: 302 });
    // Twice as wide a frame: the picture keeps its size and sits at the right.
    const wide = carrierIn({ left: 0, top: 0, width: 1120, height: 496 });
    expect(wide.left).toBe(1120 - 560 + 254);
    expect(wide.width).toBe(192);
    // Twice as big a frame in both ways: everything is twice the size.
    const big = carrierIn({ left: 0, top: 0, width: 1120, height: 992 });
    expect(big).toEqual({ left: 508, top: 276, width: 384, height: 604 });
  });

  it('finds the tiffin inside the mark, and the place to stand on a heading', () => {
    const t = tiffinIn({ left: 100, top: 10, width: 24, height: 24 });
    expect(t).toEqual({ left: 103.6, top: 12.4, width: 16.8, height: 20.2 });
    expect(tiffinIn({ left: 0, top: 0, width: 48, height: 48 }).width).toBeCloseTo(33.6);
    const s = standOn({ left: 70, top: 500, width: 400, height: 120 });
    expect(s.left).toBe(70);
    expect(s.top + s.height).toBeLessThan(500);
    expect(s.width / s.height).toBeCloseTo(192 / 302, 6);
  });
});

describe('the carrier’s journey through the page', () => {
  it('is on its shelf when the page is at the top, with no tiffin in the bar yet', () => {
    expect(at(0)).toMatchObject({ flyer: 0, mark: 0, lifted: false, docked: false });
  });

  it('lets go of the shelf as soon as the page moves, and starts from exactly where the shelf’s carrier is', () => {
    const rest = carrierIn(SCENE);
    const first = at(0.5);
    expect(first.lifted).toBe(true);
    expect(first.flyer).toBe(1);
    expect(first.box.width).toBeCloseTo(rest.width, 0);
    expect(first.box.left).toBeCloseTo(rest.left, 0);
    // It is where the page's scroll has left the shelf, and has not yet been drawn away from it.
    expect(Math.abs(first.box.top - (rest.top - 0.5))).toBeLessThan(2);
  });

  it('is carried to the first chapter’s heading and stands on it while it is read', () => {
    for (const y of [330, 400, 500, 590]) {
      const d = at(y);
      near(d.box, standOn(heading(TOPS[0]!, y)));
      expect(d).toMatchObject({ flyer: 1, lifted: true, docked: false });
      expect(d.mark, 'the bar shows only where it will go').toBeCloseTo(0.28, 6);
    }
    // On its way there it is bigger than it will be, and between the shelf and the heading.
    const mid = at(150);
    expect(mid.box.width).toBeLessThan(carrierIn(SCENE).width);
    expect(mid.box.width).toBeGreaterThan(standOn(heading(TOPS[0]!, 150)).width);
  });

  it('is put into the bar as the heading goes up, and is the mark there, until the next heading comes', () => {
    const nav = tiffinIn(MARK);
    const docked = at(900);
    expect(docked).toMatchObject({ flyer: 0, mark: 1, docked: true, lifted: true });
    near(docked.box, nav);
    // Part-way in, it is a carrier between the heading and the bar, and the mark has not yet taken over.
    const part = at(700);
    expect(part.docked).toBe(false);
    expect(part.flyer).toBe(1);
    expect(part.box.top).toBeLessThan(standOn(heading(TOPS[0]!, 700)).top);
  });

  it('is taken out of the bar and carried down to each chapter’s heading in turn, and put back after it', () => {
    for (const top of TOPS.slice(1)) {
      // Heading at the middle of the screen: it is standing on it.
      const y = top - VH * 0.5;
      const d = at(y);
      near(d.box, standOn(heading(top, y)));
      expect(d).toMatchObject({ flyer: 1, docked: false });
      // A third of the screen down, it is on its way, between the bar and the heading.
      const way = at(top - VH * 0.8);
      expect(way.docked).toBe(false);
      expect(way.box.top).toBeLessThan(standOn(heading(top, top - VH * 0.8)).top + 1);
      // The heading gone to the top of the screen, it is in the bar again.
      expect(at(top - 20)).toMatchObject({ docked: true, mark: 1, flyer: 0 });
    }
  });

  it('is in the bar between one chapter and the next, whatever the page between', () => {
    for (const y of [880, 950, 1000]) expect(at(y).docked, `at ${y}`).toBe(true);
    for (const y of [1800, 1900]) expect(at(y).docked, `at ${y}`).toBe(true);
  });

  it('never leaps: a step of the scroll moves it a little, and fades it a little, down the whole page', () => {
    // (From the first moment it is off the shelf: the shelf's own carrier, which is the same drawing in the same place,
    // is what is seen before that.)
    let prev = at(1);
    for (let y = 2; y <= 5400; y++) {
      const d = at(y);
      const a = centre(prev.box);
      const b = centre(d.box);
      expect(Math.hypot(b.x - a.x, b.y - a.y), `at ${y}`).toBeLessThan(7);
      expect(Math.abs(d.flyer - prev.flyer), `flyer at ${y}`).toBeLessThan(0.25);
      expect(Math.abs(d.mark - prev.mark), `mark at ${y}`).toBeLessThan(0.25);
      prev = d;
    }
  });

  it('is a function of the scroll alone: the same place coming or going', () => {
    const forward = [0, 300, 700, 1200, 1900, 2500, 3300, 4200].map((y) => at(y));
    const back = [4200, 3300, 2500, 1900, 1200, 700, 300, 0].map((y) => at(y)).reverse();
    expect(back).toEqual(forward);
  });

  it('goes straight to the bar when there are no headings to stand on', () => {
    const d = at(1000, [null, null, null]);
    expect(d).toMatchObject({ docked: true, mark: 1 });
    near(d.box, tiffinIn(MARK));
    expect(at(0, [null]).lifted).toBe(false);
  });

  it('waits for a carrier that starts low on the screen, as on a phone, until it has come up into view', () => {
    const phone: Box = { left: 40, top: 400, width: 330, height: 292 };
    const vh = 844;
    expect(at(0, TOPS, phone, vh).lifted).toBe(false);
    // The line it lets go at is in the upper part of the screen; the carrier's middle reaches it after a good scroll.
    const rest = carrierIn(phone);
    const reach = rest.top + rest.height / 2 - vh * 0.62;
    expect(at(reach - 1, TOPS, phone, vh).lifted).toBe(false);
    expect(at(reach + 40, TOPS, phone, vh).lifted).toBe(true);
  });
});
