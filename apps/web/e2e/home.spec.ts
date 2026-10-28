import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, shot, watchPage } from './support.ts';

test.describe('the home page', () => {
  test('says what it is, states each promise with its catch, and fits the screen', async ({
    page,
  }, info) => {
    const problems = watchPage(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Who ate, what it');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('cost, who paid');
    await expect(page.getByText(/of 80 free kitchens taken/)).toBeVisible();

    const promises = page.locator('#promises li');
    await expect(promises).toHaveCount(7);
    await expect(page.locator('#promises .limit')).toHaveCount(7);
    await expect(page.getByText('Leave, and everything goes.')).toBeVisible();
    await expect(page.getByRole('figure', { name: /example wipe receipt/i })).toBeVisible();

    // The headline is two lines at every width: the page's first answer is held in one glance.
    const lines = await page.evaluate(() =>
      [...document.querySelectorAll('h1 .line-in')].map((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
      }),
    );
    expect(lines, 'two authored lines, each fitting on one rendered line').toEqual([1, 1]);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, 'no sideways scrolling').toBeLessThanOrEqual(0);
    await shot(page, info, 'home-light');
    expect(problems, 'nothing refused by the security policy, nothing thrown').toEqual([]);
    const res = await page.request.get('/');
    expect(res.headers()['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers()['x-frame-options']).toBe('DENY');
  });

  test.describe('the live calendar', () => {
    // The page uses the visitor's own date; here it is fixed to Wednesday 10 March 2027.
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(new Date(2027, 2, 10, 10, 0));
    });

    test('freezes the days that have happened, leaves the rest tentative, and bills on the real rules', async ({
      page,
    }) => {
      await page.goto('/');
      const total = page.locator('.board-bill .total b');
      const sofar = page.locator('.board-bill .sofar b');
      await expect(page.getByRole('heading', { name: 'Meera, March 2027' })).toBeVisible();
      await expect(page.getByText('Today is Wednesday 10 March.')).toBeVisible();
      // History behind today and changes to come are marked from the start.
      await expect(total).toHaveText('₹2,830');
      await expect(sofar).toHaveText('₹950');

      // Today is the one bright tile; the weekdays of the next month are faint numbers, not tiles.
      await expect(page.locator('.day.is-today')).toHaveCount(1);
      await expect(page.locator('.day.is-today')).toHaveAccessibleName(/^Wednesday 10 March/);
      const faint = page.locator('.board-days .day-out');
      await expect(faint).toHaveText(['1', '2']); // Thursday 1 and Friday 2 April
      await expect(faint.first()).toHaveAttribute('aria-hidden', 'true');

      // Up to and including today: frozen, and cannot be changed.
      await expect(page.getByRole('button', { name: /^Monday 1 March: .*frozen/ })).toBeDisabled();
      await expect(
        page.getByRole('button', { name: /^Wednesday 10 March: .*today, frozen/ }),
      ).toBeDisabled();
      // After today: tentative, and a tap steps it through leave, switched dish, extra chapatis.
      const thursday = page.getByRole('button', { name: /^Thursday 11 March: .*tentative/ });
      await expect(thursday).toBeEnabled();
      await thursday.click(); // leave: the day's veg meal (120) is gone
      await expect(total).toHaveText('₹2,710');
      await page.getByRole('button', { name: /^Thursday 11 March: Leave/ }).click(); // non-veg: +30
      await expect(total).toHaveText('₹2,860');
      await page.getByRole('button', { name: /^Thursday 11 March/ }).click(); // two chapatis: +20
      await expect(total).toHaveText('₹2,850');
      await page.getByRole('button', { name: /^Thursday 11 March/ }).click(); // back to the day's meal
      await expect(total).toHaveText('₹2,830');
      await expect(sofar, 'a change to come does not touch what is frozen').toHaveText('₹950');

      // Every day to come can be changed from the keyboard. Friday 12 March starts as a leave;
      // the next step is a switch to the veg dish (120 where there was nothing).
      await page.getByRole('button', { name: /^Friday 12 March/ }).focus();
      await page.keyboard.press('Enter');
      await expect(total).toHaveText('₹2,950');

      // Clearing removes only what is still to come; the frozen history stays.
      await page.getByRole('button', { name: 'Clear the changes still to come' }).click();
      await expect(total).toHaveText('₹2,930');
      await expect(sofar).toHaveText('₹950');
    });

    test('looks ahead to a month not begun, and back at one that is over', async ({ page }) => {
      await page.goto('/');
      const total = page.locator('.board-bill .total b');
      await page.getByRole('button', { name: 'Next month' }).click();
      await expect(page.getByRole('heading', { name: 'Meera, April 2027' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Next month' })).toBeDisabled();
      await expect(total).toHaveText('₹2,940');
      await expect(page.locator('.board-bill .sofar'), 'nothing is frozen yet').toHaveCount(0);
      await expect(page.locator('.board-days .day:disabled')).toHaveCount(0);
      await expect(page.locator('.board-days .day')).toHaveCount(22);

      await page.getByRole('button', { name: 'Previous month' }).click();
      await page.getByRole('button', { name: 'Previous month' }).click();
      await expect(page.getByRole('heading', { name: 'Meera, February 2027' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Previous month' })).toBeDisabled();
      await expect(total).toHaveText('₹2,670');
      await expect(page.getByText('Meera’s bill for February', { exact: true })).toBeVisible();
      await expect(page.locator('.board-days .day:enabled'), 'all of it has happened').toHaveCount(
        0,
      );
    });
  });

  test('keeps the title beside the picture while the words pass', async ({ page }, info) => {
    await page.goto('/');
    const title = page.locator('#moving-title');
    const centre = (i: number) =>
      page.evaluate((n) => {
        const li = document.querySelectorAll('.steps li')[n]!;
        const r = li.getBoundingClientRect();
        window.scrollBy({
          top: r.top + r.height / 2 - window.innerHeight / 2,
          behavior: 'instant',
        });
      }, i);
    const top = async () => Math.round((await title.boundingBox())!.y);
    const tops: number[] = [];
    for (const i of [0, 1, 2]) {
      await centre(i);
      await expect(page.locator('.steps li').nth(i)).toHaveClass(/on/);
      if (info.project.name === 'desktop') {
        await expect(title, 'the title is on screen at every step').toBeInViewport({ ratio: 1 });
        tops.push(await top());
      }
    }
    if (info.project.name === 'desktop') {
      expect(
        Math.abs(tops[2]! - tops[1]!),
        'it does not move while the steps scroll',
      ).toBeLessThanOrEqual(2);
    } else {
      // On a phone the title scrolls away and the picture holds, under the bar.
      const picture = await page.locator('.stage-wrap').boundingBox();
      expect(Math.round(picture!.y)).toBe(64);
    }
  });

  test('ends on the name, dim and cut off at its foot, lit only where a light passes, and it cannot be selected', async ({
    page,
  }) => {
    await page.goto('/');
    const mega = page.locator('.mega');
    await expect(mega).toHaveAttribute('aria-hidden', 'true');
    const style = await mega.evaluate((el) => {
      const c = getComputedStyle(el);
      const base = getComputedStyle(el.querySelector('.mega-base')!);
      const lit = getComputedStyle(el.querySelector('.mega-lit')!);
      return {
        select: c.userSelect,
        fade: base.maskImage.includes('linear-gradient'),
        // The lit copy shows only inside a round patch, and only above the foot.
        patch:
          lit.maskImage.includes('radial-gradient') && lit.maskImage.includes('linear-gradient'),
        both: lit.maskComposite,
      };
    });
    expect(style).toEqual({
      select: 'none',
      fade: true,
      patch: true,
      both: 'intersect, intersect',
    });
  });

  test('has a light that follows the pointer across the name', async ({ page, isMobile }, info) => {
    test.skip(isMobile, 'there is no pointer to follow on a phone');
    await page.goto('/');
    const foot = page.locator('.hfoot');
    await foot.scrollIntoViewIfNeeded();
    const mega = page.locator('.mega');
    const box = (await mega.boundingBox())!;
    const lx = async () =>
      parseFloat(await mega.evaluate((e) => e.style.getPropertyValue('--lx') || '50'));
    await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.5, { steps: 6 });
    await expect.poll(lx, { message: 'the light goes to the left' }).toBeLessThan(25);
    await foot.screenshot({ path: info.outputPath('desktop-name-lit-left.png') });
    await page.mouse.move(box.x + box.width * 0.88, box.y + box.height * 0.5, { steps: 6 });
    await expect.poll(lx, { message: 'and to the right' }).toBeGreaterThan(75);
    await foot.screenshot({ path: info.outputPath('desktop-name-lit-right.png') });
  });

  test('has a light that wanders on its own when motion is allowed, and rests when it is not', async ({
    page,
  }) => {
    const lx = () =>
      page.locator('.mega').evaluate((e) => parseFloat(e.style.getPropertyValue('--lx') || '50'));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await page.locator('.hfoot').scrollIntoViewIfNeeded();
    const first = await lx();
    await expect
      .poll(async () => Math.abs((await lx()) - first), { timeout: 8000 })
      .toBeGreaterThan(3);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await page.locator('.hfoot').scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    expect(await lx(), 'it rests in the middle').toBeCloseTo(50, 0);
  });

  test('has steam coming out from behind the lids, that stops when it is out of view or motion is reduced', async ({
    page,
  }) => {
    const steam = () =>
      page.evaluate(() => {
        const path = document.querySelector('.hero-scene .steam path')!;
        const c = getComputedStyle(path);
        return {
          name: c.animationName,
          state: c.animationPlayState,
          live: document.querySelector<HTMLElement>('.hero')!.dataset.live,
        };
      });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await expect.poll(async () => (await steam()).live).toBe('true');
    expect(await steam()).toEqual({ name: 'wisp-flow', state: 'running', live: 'true' });
    await page.locator('.hfoot').scrollIntoViewIfNeeded();
    await expect.poll(async () => (await steam()).live).toBe('false');
    expect((await steam()).state, 'it does not run where nobody can see it').toBe('paused');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect((await steam()).name, 'with reduced motion it does not move').toBe('none');
  });

  test('draws the steam as something that comes out of a lid, and no two wisps keep the same time', async ({
    page,
  }) => {
    await page.goto('/');
    const found = await page.evaluate(() => {
      const wisps = [...document.querySelectorAll<SVGGElement>('.hero-scene .steam .wisp')];
      const lids = [
        // The carrier's steam is drawn before the carrier, and the pot's before the pot.
        ['.hero-carrier .steam', '.hero-carrier .carrier'],
        ['.pot .steam', '.pot > rect'],
      ].map(([steam, lid]) => {
        const s = document.querySelector(steam!)!;
        const l = document.querySelector(lid!)!;
        return !!(s.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      const ids = [...document.querySelectorAll('[id^="steam-"]')].map((e) => e.id);
      return {
        count: wisps.length,
        lids,
        lives: new Set(wisps.map((w) => getComputedStyle(w).getPropertyValue('--life'))).size,
        swings: new Set(wisps.map((w) => getComputedStyle(w).getPropertyValue('--swing'))).size,
        uniqueIds: new Set(ids).size === ids.length,
        masked: document.querySelectorAll('.hero-scene .steam g[mask]').length,
      };
    });
    expect(found).toEqual({
      count: 6,
      lids: [true, true],
      lives: 6,
      swings: 6,
      uniqueIds: true,
      masked: 2,
    });
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`gives whatever hangs on the wall the same shadow in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      const shadows = await page.evaluate(() => {
        const box = (sel: string, pseudo?: string) =>
          getComputedStyle(document.querySelector(sel)!, pseudo).boxShadow;
        return {
          board: box('.board'),
          stage: box('.stage'),
          stepCard: box('.steps li', '::after'),
          receipt: getComputedStyle(document.querySelector('.printer')!).filter,
        };
      });
      expect(shadows.board).not.toBe('none');
      expect(shadows.stage).toBe(shadows.board);
      expect(shadows.stepCard).toBe(shadows.board);
      expect(shadows.receipt).toContain('drop-shadow');
      // Nothing flat is lifted: a button and a day tile stay on the surface.
      const flat = await page.evaluate(() => [
        getComputedStyle(document.querySelector('.btn')!).boxShadow,
        getComputedStyle(document.querySelector('.day')!).boxShadow,
      ]);
      expect(flat).toEqual(['none', 'none']);
    });
  }

  test('says what an entry is, and that the figures are for the whole kitchen', async ({
    page,
  }) => {
    await page.goto('/');
    const free = page.locator('#free');
    await expect(free).toContainText('What counts as an entry?');
    await expect(free).toContainText('not per person');
    await expect(free).toContainText('actions a day, all together');
  });

  test('shows every digit of the free-tier figures whole', async ({ page }) => {
    await page.goto('/');
    // The rolling columns are clipped above and below, never at the sides: a figure's right edge can
    // reach past its box, and a side clip shaves the last zero.
    const clip = await page
      .locator('.roll-col')
      .first()
      .evaluate((el) => {
        const c = getComputedStyle(el);
        return [c.overflowX, c.overflowY];
      });
    expect(clip).toEqual(['visible', 'clip']);
    await expect(page.locator('.limits')).toContainText('5,000');
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`is readable in ${scheme} mode`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page, `home (${scheme})`);
      await shot(page, info, `home-${scheme}`);
    });
  }

  test('leads to sign-in, and the sign-in page is accessible', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Start your kitchen' }).click();
    await expect(page).toHaveURL(/\/signin/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expectAccessible(page, 'sign in');
  });

  test('can be installed: it has a manifest with icons, and a service worker takes over', async ({
    page,
    request,
  }) => {
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/app');
    expect(manifest.theme_color).toBe('#1F4D3A');
    const sizes = manifest.icons.map(
      (i: { sizes: string; purpose?: string }) => `${i.sizes}${i.purpose ? `:${i.purpose}` : ''}`,
    );
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512', '512x512:maskable']));
    for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);

    await page.goto('/');
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state))
      .toBe('activated');
  });

  test('shows nothing of any kitchen to a stranger, and sends them to sign in', async ({
    page,
  }) => {
    await page.goto('/w/whatever');
    await expect(page).toHaveURL(/\/signin\?next=/);
    await page.goto('/receipt/not-a-real-receipt');
    await expect(page.getByText('There is no receipt with that address.')).toBeVisible();
  });
  test.describe('with motion on', () => {
    test.use({ reducedMotion: 'no-preference' });

    test('every part arrives as it is reached, and nothing is left hidden', async ({ page }) => {
      const problems = watchPage(page);
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const waiting = () =>
        page.evaluate(
          () =>
            [...document.querySelectorAll('[data-reveal]')].filter(
              (e) => !e.classList.contains('is-in'),
            ).length,
        );
      expect(await waiting(), 'parts below the first screen wait to be reached').toBeGreaterThan(
        10,
      );
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y <= height; y += 350) {
        await page.evaluate((to) => window.scrollTo(0, to), y);
        await page.waitForTimeout(40);
      }
      await expect.poll(waiting, { message: 'every part has arrived' }).toBe(0);
      expect(problems).toEqual([]);
    });

    test('the carrier is lifted from place to place as the page is read', async ({ page }) => {
      await page.goto('/');
      const poses = [
        'translate(178px, 330px) scale(0.34)',
        'translate(538px, 213px) scale(0.62)',
        'translate(930px, 265px) scale(0.62)',
      ];
      const centre = (i: number) =>
        page.evaluate((n) => {
          const li = document.querySelectorAll('.steps li')[n]!;
          const r = li.getBoundingClientRect();
          window.scrollBy({
            top: r.top + r.height / 2 - window.innerHeight / 2,
            behavior: 'instant',
          });
        }, i);
      for (const [i, pose] of poses.entries()) {
        await centre(i);
        await expect(page.locator('.moving')).toHaveAttribute('data-step', String(i));
        // The hop takes a second; afterwards the carrier is exactly where the step says.
        await expect
          .poll(() => page.locator('.mover').evaluate((el) => (el as SVGElement).style.transform))
          .toBe(pose);
        await expect(page.locator('.steps li').nth(i)).toHaveClass(/on/);
      }
    });

    test('the carrier glides and never snaps, however hard the page is scrolled back and forth', async ({
      page,
    }, info) => {
      await page.goto('/');
      await page.locator('.moving').scrollIntoViewIfNeeded();
      const trail = await page.evaluate(async () => {
        const stage = document.querySelector('.stage')!;
        const mover = document.querySelector('.mover')!;
        const items = [...document.querySelectorAll('.steps li')];
        const centre = (i: number) => {
          const r = items[i]!.getBoundingClientRect();
          return r.top + r.height / 2 - window.innerHeight / 2 + window.scrollY;
        };
        const from = centre(0);
        const to = centre(2);
        const seen: { t: number; x: number; y: number }[] = [];
        const t0 = performance.now();
        await new Promise<void>((done) => {
          const frame = (now: number) => {
            const t = (now - t0) / 1000;
            // Across all three places and back, over a second each way: a hand flicking a trackpad.
            const phase = (Math.sin(t * Math.PI * 2 * 0.9) + 1) / 2;
            window.scrollTo({ top: from + (to - from) * phase, behavior: 'instant' });
            const s = stage.getBoundingClientRect();
            const m = mover.getBoundingClientRect();
            seen.push({ t, x: m.left + m.width / 2 - s.left, y: m.top + m.height / 2 - s.top });
            if (t < 4) requestAnimationFrame(frame);
            else done();
          };
          requestAnimationFrame(frame);
        });
        return seen;
      });
      let fastest = 0;
      let travelled = 0;
      for (let i = 1; i < trail.length; i++) {
        const d = Math.hypot(trail[i]!.x - trail[i - 1]!.x, trail[i]!.y - trail[i - 1]!.y);
        const dt = Math.max(trail[i]!.t - trail[i - 1]!.t, 1 / 120);
        travelled += d;
        fastest = Math.max(fastest, d / dt);
      }
      info.annotations.push({ type: 'fastest', description: `${Math.round(fastest)} px/s` });
      expect(travelled, 'the carrier did travel').toBeGreaterThan(600);
      // A hop crosses the picture in about a second: a few hundred pixels a second. A snap back to where it
      // last landed is the whole picture in one frame, tens of thousands.
      expect(fastest, `the carrier jumped (${Math.round(fastest)} px/s)`).toBeLessThan(3000);
    });

    // Where the browser can follow the scroll with an animation, the page is one motion: the parts arrive by how
    // far up the screen they are, the sheets ease flat as they come up, and the mark in the bar is packed as it is read.
    test.describe('tied to the scroll', () => {
      test.beforeEach(async ({ page }) => {
        await page.goto('/');
        const can = await page.evaluate(() => CSS.supports('animation-timeline: view()'));
        test.skip(
          !can,
          'this browser cannot tie an animation to the scroll, so the parts arrive timed',
        );
      });
      /** Scrolls so that the top of `selector` is `f` of the way down the screen, and says what `read` finds. */
      const at = <T>(page: Page, selector: string, f: number, read: (el: Element) => T) =>
        page
          .evaluate(
            ([sel, f]) => {
              const el = document.querySelector(sel as string)!;
              const top = el.getBoundingClientRect().top + window.scrollY;
              window.scrollTo({
                top: top - (f as number) * window.innerHeight,
                behavior: 'instant',
              });
              return new Promise<unknown>((done) =>
                requestAnimationFrame(() => requestAnimationFrame(() => done(el))),
              );
            },
            [selector, f],
          )
          .then(async () => page.locator(selector).first().evaluate(read));

      test('every part arrives as far as it has come up the screen, and goes back as the page goes back', async ({
        page,
      }) => {
        const opacity = (f: number) =>
          at(page, '#free .statement', f, (el) => Number(getComputedStyle(el).opacity));
        const far = await opacity(0.98);
        const half = await opacity(0.9);
        const near = await opacity(0.55);
        expect(far, 'at the foot of the screen it has not come').toBeLessThan(0.4);
        expect(half, 'part-way up it is part-way there').toBeGreaterThan(far);
        expect(half).toBeLessThan(1);
        expect(near, 'higher up it is all there').toBe(1);
        expect(await opacity(0.98), 'and scrolled back, it goes').toBeLessThan(0.4);
      });

      test('the sheets lie over one another with rounded corners that ease flat as each comes up', async ({
        page,
      }) => {
        const radius = (f: number) =>
          at(page, '#free', f, (el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
        expect(await radius(0.98), 'rounded as it comes in').toBeGreaterThan(20);
        const mid = await radius(0.85);
        expect(mid).toBeGreaterThan(0);
        expect(mid).toBeLessThan(await radius(0.98));
        expect(await radius(0.2), 'flat by the time it has come up').toBe(0);
        // Each sheet is drawn over the bottom of the one before, which is paid for in padding, so nothing moves.
        const overlap = await page.evaluate(() => {
          const free = document.querySelector('#free')!.getBoundingClientRect().top;
          const before = document.querySelector('#try')!.getBoundingClientRect().bottom;
          return Math.round(before - free);
        });
        expect(overlap).toBeGreaterThan(20);
      });

      test('the bar names the chapter being read, and its mark is packed tier by tier as the page is read', async ({
        page,
      }) => {
        const bar = page.locator('.hnav nav');
        await expect(bar.locator('[aria-current]')).toHaveCount(0);
        await at(page, '#free', 0.2, () => 0);
        await expect(bar.locator('a[aria-current="location"]')).toHaveText('Free');
        await at(page, '#leaving', 0.2, () => 0);
        await expect(bar.locator('a[aria-current="location"]')).toHaveText('Leaving');

        const packed = () =>
          page.evaluate(() =>
            [1, 2, 3, 4].map((n) => {
              const m = new DOMMatrix(
                getComputedStyle(document.querySelector(`.hnav .mark-fill-${n}`)!).transform,
              );
              return Math.round(m.a * 100) / 100;
            }),
          );
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await expect.poll(packed).toEqual([0, 0, 0, 0]);
        await page.evaluate(() =>
          window.scrollTo({
            top: document.documentElement.scrollHeight,
            behavior: 'instant',
          }),
        );
        await expect.poll(packed).toEqual([1, 1, 1, 1]);
        await page.evaluate(() =>
          window.scrollTo({
            top: (document.documentElement.scrollHeight - window.innerHeight) * 0.43,
            behavior: 'instant',
          }),
        );
        const some = await packed();
        expect(some[0], 'the first tier is full by then').toBe(1);
        expect(some[3], 'and the lid is not yet').toBe(0);
      });

      test('the first screen lets go in layers, and the light over the name comes on as the foot comes up', async ({
        page,
      }) => {
        const lift = (f: number) =>
          at(page, '.hfoot', f, () => 0).then(() =>
            page.evaluate(() => getComputedStyle(document.querySelector('.hero-scene')!).translate),
          );
        expect(await lift(5)).not.toBe('none');
        const lit = (f: number) =>
          at(page, '.mega-lit', f, (el) => Number(getComputedStyle(el).opacity));
        expect(await lit(0.98)).toBeLessThan(0.3);
        expect(await lit(0.4), 'and is on by the foot of the page').toBeGreaterThan(0.95);
      });
    });

    test('the carrier steams when it is set down, and not while it is in the air', async ({
      page,
    }) => {
      await page.goto('/');
      const moving = page.locator('.moving');
      await page.evaluate(() => {
        const r = document.querySelectorAll('.steps li')[2]!.getBoundingClientRect();
        window.scrollBy({
          top: r.top + r.height / 2 - window.innerHeight / 2,
          behavior: 'instant',
        });
      });
      await expect(moving).toHaveAttribute('data-hop', 'true');
      const air = () =>
        page.locator('.stage .steam').evaluate((e) => Number(getComputedStyle(e).opacity));
      await expect
        .poll(air, { message: 'it is gone while the carrier is lifted' })
        .toBeLessThan(0.1);
      await expect(moving).toHaveAttribute('data-hop', 'false');
      await expect.poll(air, { message: 'and back once it is down' }).toBeGreaterThan(0.95);
    });
  });
});
