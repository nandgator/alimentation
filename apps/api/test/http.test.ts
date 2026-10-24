import { openSync, closeSync, readSync, statSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rupees } from '@alimentation/core';
import { ADMIN_URL } from './support/pg.ts';
import { MENU, makePlatform, type Client, type TestPlatform } from './support/platform.ts';

const RATES = {
  effectiveFrom: '2026-04-01',
  veg: rupees(150),
  nonVeg: rupees(170),
  extraChapati: rupees(15),
  extraBhakri: rupees(30),
  extrasPerMonth: rupees(40),
  menu: MENU,
};

describe('two kitchens on one platform', () => {
  let p: TestPlatform;
  let namrata: Client;
  let ymca: Client;
  let jovial: Client;
  let smruti: Client;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    p = await makePlatform();
    namrata = await p.signIn('namrata@example.org', 'Namrata');
    ymca = await p.signIn('ymca@example.org', 'YMCA Office');
    jovial = await p.signIn('jovial@example.org', 'Jovial');
    smruti = await p.signIn('smruti@example.org', 'Smruti');
  });
  afterAll(async () => p.destroy());

  it('creates a workspace for each, each with its own database and its creator as admin', async () => {
    const a = await namrata.post('/api/workspaces', {
      slug: 'namrata',
      name: "Namrata's kitchen",
      alsoSupplier: true,
    });
    expect(a.status).toBe(201);
    expect(a.json.roles).toEqual(['admin', 'supplier']);
    const b = await ymca.post('/api/workspaces', {
      slug: 'ymca-mess',
      name: 'YMCA mess',
      alsoSupplier: false,
    });
    expect(b.status).toBe(201);
    expect(b.json.roles).toEqual(['admin']);
    const rows = await p.runtime.deps.control.allWorkspaces();
    expect(new Set(rows.map((r) => r.placement.data.database)).size).toBe(2);
    expect(
      (await namrata.get('/api/me')).json.workspaces.map((w: { slug: string }) => w.slug),
    ).toEqual(['namrata']);
    expect(
      (await ymca.get('/api/me')).json.workspaces.map((w: { slug: string }) => w.slug),
    ).toEqual(['ymca-mess']);
  });

  it('refuses an address that is taken, reserved or malformed, and tells a signed-out visitor to sign in', async () => {
    expect(
      (await ymca.post('/api/workspaces', { slug: 'namrata', name: 'x' })).json.error.code,
    ).toBe('slug_taken');
    expect((await ymca.post('/api/workspaces', { slug: 'admin', name: 'x' })).status).toBe(422);
    expect((await ymca.post('/api/workspaces', { slug: 'Bad Name', name: 'x' })).status).toBe(422);
    expect(
      (await ymca.post('/api/workspaces', { slug: 'ok-name', name: 'x', timeZone: 'Mars/Base' }))
        .status,
    ).toBe(422);
    expect(
      (await p.anonymous().post('/api/workspaces', { slug: 'anon-ws', name: 'x' })).status,
    ).toBe(401);
  });

  it("sets up Namrata's kitchen: prices, people, and an invitation each", async () => {
    expect((await namrata.post('/api/w/namrata/rate-cards', RATES)).status).toBe(201);
    for (const [name, key] of [
      ['Jovial', 'jovial'],
      ['Smruti', 'smruti'],
    ] as const) {
      const r = await namrata.post('/api/w/namrata/people', {
        name,
        role: 'consumer',
        activeFrom: '2026-10-01',
      });
      expect(r.status).toBe(201);
      ids[key] = r.json.id;
      const inv = await namrata.post(`/api/w/namrata/people/${r.json.id}/invite`, {
        email: `${key}@example.org`,
      });
      expect(inv.status).toBe(201);
      expect(inv.json.link).toMatch(/^http:\/\/localhost\/join#/);
      ids[`${key}-token`] = inv.json.link.split('#')[1];
    }
    expect((await jovial.post('/api/invites/accept', { token: ids['jovial-token'] })).json).toEqual(
      { slug: 'namrata', role: 'consumer' },
    );
    expect((await smruti.post('/api/invites/accept', { token: ids['smruti-token'] })).status).toBe(
      200,
    );
  });

  it('puts Jovial in the YMCA mess as well, with one sign-in', async () => {
    expect(
      (
        await ymca.post('/api/w/ymca-mess/rate-cards', {
          ...RATES,
          veg: rupees(60),
          nonVeg: rupees(80),
        })
      ).status,
    ).toBe(201);
    const person = await ymca.post('/api/w/ymca-mess/people', {
      name: 'Jovial',
      role: 'consumer',
      activeFrom: '2026-10-01',
    });
    const inv = await ymca.post(`/api/w/ymca-mess/people/${person.json.id}/invite`, {
      email: 'jovial@example.org',
    });
    expect(
      (await jovial.post('/api/invites/accept', { token: inv.json.link.split('#')[1] })).json.slug,
    ).toBe('ymca-mess');
    const me = await jovial.get('/api/me');
    expect(me.json.workspaces.map((w: { slug: string }) => w.slug).sort()).toEqual([
      'namrata',
      'ymca-mess',
    ]);
    ids['jovial-ymca'] = person.json.id;
  });

  it("[P1] bills the same person differently in each, from each kitchen's own prices and rules", async () => {
    const stmt = async (c: Client, slug: string, person: string) =>
      (await c.get(`/api/w/${slug}/statements?months=2026-10&person=${person}`)).json[0];
    // 22 weekdays minus nothing (no holidays entered here): 9 Non Veg days and 13 Veg.
    const n = await stmt(jovial, 'namrata', ids.jovial!);
    const y = await stmt(jovial, 'ymca-mess', ids['jovial-ymca']!);
    expect(n.liveTotal).toBe(13 * rupees(150) + 9 * rupees(170) + rupees(40));
    expect(y.liveTotal).toBe(13 * rupees(60) + 9 * rupees(80) + rupees(40));
  });

  it("[P7] shows a consumer only their own statement, and nothing of anyone else's", async () => {
    const mine = await jovial.get('/api/w/namrata/bootstrap');
    expect(mine.status).toBe(200);
    expect(mine.json.me.role).toBe('consumer');
    expect(mine.json.statements.map((s: { name: string }) => s.name)).toEqual(['Jovial']);
    expect(mine.json.people.map((x: { name: string }) => x.name)).toEqual(['Jovial']);
    expect(
      (await jovial.get(`/api/w/namrata/statements?months=2026-10&person=${ids.smruti}`)).status,
    ).toBe(404);
    expect((await jovial.get('/api/w/namrata/audit')).status).toBe(403);
    expect(
      (await jovial.post('/api/w/namrata/people', { name: 'Intruder', role: 'admin' })).status,
    ).toBe(403);
    const boss = await namrata.get('/api/w/namrata/bootstrap');
    expect(boss.json.statements.map((s: { name: string }) => s.name).sort()).toEqual([
      'Jovial',
      'Smruti',
    ]);
  });

  it("[P1] keeps a workspace's members out of the other workspace", async () => {
    expect((await smruti.get('/api/w/ymca-mess/bootstrap')).status).toBe(403);
    expect((await namrata.get('/api/w/ymca-mess/bootstrap')).status).toBe(403);
    expect((await ymca.get('/api/w/namrata/bootstrap')).status).toBe(403);
    expect((await p.anonymous().get('/api/w/namrata/bootstrap')).status).toBe(401);
    expect((await namrata.get('/api/w/nobody-here/bootstrap')).status).toBe(404);
  });

  it('lets a kitchen owner who is also the supplier switch hats, and keeps the hats apart', async () => {
    const claim = await jovial.post('/api/w/namrata/claims', {
      consumerId: ids.jovial,
      paidAt: '2026-10-20',
      forMonth: '2026-10',
      amount: rupees(100),
      method: 'UPI',
    });
    expect(claim.status).toBe(201);
    const asAdmin = await namrata.post(`/api/w/namrata/claims/${claim.json.id}/decision`, {
      decision: 'Confirmed',
    });
    expect(asAdmin.status).toBe(422); // the admin hat cannot decide
    const asSupplier = await namrata.post(
      `/api/w/namrata/claims/${claim.json.id}/decision`,
      { decision: 'Confirmed' },
      { 'x-acting-as': 'supplier' },
    );
    expect(asSupplier.status).toBe(201);
    expect(
      (
        await namrata.post(
          `/api/w/namrata/claims/${claim.json.id}/decision`,
          { decision: 'Disputed', note: 'no' },
          { 'x-acting-as': 'supplier' },
        )
      ).status,
    ).toBe(422);
    expect(
      (await namrata.get('/api/w/namrata/bootstrap', { 'x-acting-as': 'supplier' })).json.me.role,
    ).toBe('supplier');
    expect(
      (await jovial.get('/api/w/namrata/bootstrap', { 'x-acting-as': 'admin' })).json.me.role,
    ).toBe('consumer'); // asking for a hat you do not hold changes nothing
  });
});

describe('invitations', () => {
  let p: TestPlatform;
  beforeAll(async () => {
    p = await makePlatform();
  });
  afterAll(async () => p.destroy());

  it('works once, for the right email, and not after it expires', async () => {
    const owner = await p.signIn('owner@example.org', 'Owner');
    await owner.post('/api/workspaces', { slug: 'inv-test', name: 'Invites' });
    const person = (
      await owner.post('/api/w/inv-test/people', {
        name: 'Guest',
        role: 'consumer',
        activeFrom: '2026-10-01',
      })
    ).json.id;
    const link = (
      await owner.post(`/api/w/inv-test/people/${person}/invite`, { email: 'Guest@Example.org' })
    ).json.link as string;
    const token = link.split('#')[1]!;
    const wrong = await p.signIn('someone-else@example.org');
    expect((await wrong.post('/api/invites/accept', { token })).status).toBe(403);
    const guest = await p.signIn('guest@example.org', 'Guest');
    expect((await guest.post('/api/invites/accept', { token })).status).toBe(200);
    expect((await guest.post('/api/invites/accept', { token })).status).toBe(410); // used
    expect((await guest.post('/api/invites/accept', { token: 'x'.repeat(40) })).status).toBe(410); // unknown

    const late = (await owner.post('/api/w/inv-test/people', { name: 'Late', role: 'consumer' }))
      .json.id;
    const lateToken = (
      (await owner.post(`/api/w/inv-test/people/${late}/invite`, { email: 'late@example.org' }))
        .json.link as string
    ).split('#')[1]!;
    p.clock.now = new Date('2026-11-05T06:00:00Z'); // eight days on
    const lateGuest = await p.signIn('late@example.org');
    expect((await lateGuest.post('/api/invites/accept', { token: lateToken })).status).toBe(410);
  });

  it('refuses an invitation from anyone but the admin, and a malformed address', async () => {
    p.clock.now = new Date('2026-10-24T06:00:00Z');
    const owner = await p.signIn('owner2@example.org');
    await owner.post('/api/workspaces', { slug: 'inv-test-2', name: 'Invites two' });
    const person = (
      await owner.post('/api/w/inv-test-2/people', { name: 'Guest', role: 'consumer' })
    ).json.id;
    expect(
      (await owner.post(`/api/w/inv-test-2/people/${person}/invite`, { email: 'not-an-email' }))
        .status,
    ).toBe(422);
    const rate = await owner.post('/api/w/inv-test-2/rate-cards', RATES);
    expect(rate.status).toBe(201);
  });
});

describe('who may do what, over HTTP', () => {
  let p: TestPlatform;
  beforeAll(async () => {
    p = await makePlatform();
  });
  afterAll(async () => p.destroy());

  it('refuses a write that comes from another site, whatever the cookie says', async () => {
    const c = await p.signIn('csrf@example.org');
    const origin = await c.post(
      '/api/workspaces',
      { slug: 'csrf-one', name: 'x' },
      { origin: 'https://evil.example' },
    );
    expect(origin.status).toBe(403);
    const site = await c.post(
      '/api/workspaces',
      { slug: 'csrf-two', name: 'x' },
      { 'sec-fetch-site': 'cross-site' },
    );
    expect(site.status).toBe(403);
    expect((await c.post('/api/workspaces', { slug: 'csrf-three', name: 'x' })).status).toBe(201);
  });

  it('treats a forged, altered or expired session as no session', async () => {
    const c = await p.signIn('forge@example.org');
    expect((await c.get('/api/me')).json.account.email).toBe('forge@example.org');
    const res = await p.runtime.app.request('http://localhost/api/me', {
      headers: { cookie: 'session=eyJhIjoiMSJ9.AAAA' },
    });
    expect((await res.json()).account).toBeNull();
    const real = (
      await p.runtime.deps.signer.sign({ a: 'x', e: 'x@example.org', n: null }, 60, p.clock.now)
    ).split('.');
    const tampered = await p.runtime.app.request('http://localhost/api/me', {
      headers: { cookie: `session=${real[0]}x.${real[1]}` },
    });
    expect((await tampered.json()).account).toBeNull();
    p.clock.now = new Date('2026-10-25T06:00:00Z'); // a day later than the 12 hour session
    expect((await c.get('/api/me')).json.account).toBeNull();
    p.clock.now = new Date('2026-10-24T06:00:00Z');
  });

  it('signs out', async () => {
    const c = await p.signIn('bye@example.org');
    expect((await c.post('/auth/logout')).status).toBe(204);
    expect((await c.get('/api/me')).json.account).toBeNull();
  });

  it('lets only an operator see the platform', async () => {
    const user = await p.signIn('plain@example.org');
    expect((await user.get('/api/platform/workspaces')).status).toBe(403);
    const op = await p.signIn('operator@example.org');
    const r = await op.get('/api/platform/workspaces');
    expect(r.status).toBe(200);
    expect(r.json.capacity).toMatchObject({ open: true });
    expect((await op.get('/api/platform/events')).json.events.length).toBeGreaterThan(0);
  });

  it('shows anyone how many free places are left', async () => {
    const r = await p.anonymous().get('/api/public/capacity');
    expect(r.json).toMatchObject({ capacity: 80, open: true });
  });

  it('answers unknown routes and bad bodies in one shape', async () => {
    const c = await p.signIn('shape@example.org');
    const nf = await c.get('/api/nothing');
    expect(nf.status).toBe(404);
    expect(nf.json.error).toMatchObject({ code: 'not_found' });
    const bad = await c.req('POST', '/api/workspaces', 'not json at all' as never);
    expect([400, 422]).toContain(bad.status);
    expect(bad.json.error.id).toBeTruthy();
  });

  it('refuses development sign-in where it is not enabled', async () => {
    const q = await makePlatform({}, { devAuth: false });
    try {
      const r = await q.anonymous().post('/auth/dev-login', { email: 'x@example.org' });
      expect(r.status).toBe(404);
    } finally {
      await q.destroy();
    }
  });
});

describe("[P1] one workspace cannot use up the others' requests", () => {
  let p: TestPlatform;
  beforeAll(async () => {
    p = await makePlatform({
      FREE_LIMITS_JSON: JSON.stringify({ requestsPerDay: 6 }),
      HARD_CAP_FACTOR: '1',
    });
  });
  afterAll(async () => p.destroy());

  it('turns a workspace away for the day once it has used its budget, and serves the other', async () => {
    const a = await p.signIn('busy@example.org');
    const b = await p.signIn('quiet@example.org');
    await a.post('/api/workspaces', { slug: 'busy', name: 'Busy' });
    await b.post('/api/workspaces', { slug: 'quiet', name: 'Quiet' });
    const statuses: number[] = [];
    for (let i = 0; i < 9; i++) statuses.push((await a.get('/api/w/busy/bootstrap')).status);
    expect(statuses.slice(0, 6)).toEqual(Array(6).fill(200));
    // Counts are written in batches, so the cut-off follows within a few requests of the budget.
    await p.runtime.deps.gate.flush();
    const after = await a.get('/api/w/busy/bootstrap');
    expect(after.status).toBe(429);
    expect(after.json.error.code).toBe('budget_reached');
    expect(Number(after.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await b.get('/api/w/quiet/bootstrap')).status).toBe(200);
  });

  it('slows a flood, whatever the daily budget', async () => {
    const q = await makePlatform({ FREE_LIMITS_JSON: JSON.stringify({ requestsPerDay: 100_000 }) });
    try {
      const c = await q.signIn('flood@example.org');
      await c.post('/api/workspaces', { slug: 'flood', name: 'Flood' });
      const codes: number[] = [];
      for (let i = 0; i < 60; i++) codes.push((await c.get('/api/w/flood/bootstrap')).status);
      expect(codes.filter((s) => s === 429).length).toBeGreaterThan(0);
      expect(codes.slice(0, 10).every((s) => s === 200)).toBe(true);
    } finally {
      await q.destroy();
    }
  });
});

describe('[P2] the free places are finite, and the platform says so', () => {
  it('refuses a new workspace when the free capacity is used, without breaking existing ones', async () => {
    const p = await makePlatform({
      CAPACITY_JSON: JSON.stringify({ hostProjects: 4, reservedProjects: 2 }),
    });
    try {
      const a = await p.signIn('first@example.org');
      const b = await p.signIn('second@example.org');
      const c = await p.signIn('third@example.org');
      expect((await a.post('/api/workspaces', { slug: 'one-ws', name: 'One' })).status).toBe(201);
      expect((await b.post('/api/workspaces', { slug: 'two-ws', name: 'Two' })).status).toBe(201);
      const full = await c.post('/api/workspaces', { slug: 'three-ws', name: 'Three' });
      expect(full.status).toBe(503);
      expect(full.json.error.code).toBe('full');
      expect((await p.anonymous().get('/api/public/capacity')).json).toMatchObject({
        capacity: 2,
        used: 2,
        open: false,
      });
      expect((await a.get('/api/w/one-ws/bootstrap')).status).toBe(200);
      const left = await p.runtime.deps.control.allWorkspaces();
      expect(left).toHaveLength(2);
    } finally {
      await p.destroy();
    }
  });
});

describe('[P5] no plaintext personal data reaches a log, application or database', () => {
  const PG_LOG = process.env.ALIMENTATION_TEST_PG_LOG ?? '/opt/pg18data/log';
  const readable = (() => {
    try {
      statSync(PG_LOG);
      return true;
    } catch {
      return false;
    }
  })();

  it.runIf(readable)(
    'keeps names, contacts and notes out of the Postgres log with every statement logged',
    async () => {
      const p = await makePlatform();
      const admin = new pg.Client({ connectionString: ADMIN_URL });
      await admin.connect();
      try {
        const owner = await p.signIn('zzowner@example.org', 'ZZSENTINELOWNER');
        expect(
          (
            await owner.post('/api/workspaces', {
              slug: 'logcheck',
              name: 'Log check',
              alsoSupplier: true,
            })
          ).status,
        ).toBe(201);
        const ws = await p.runtime.deps.control.workspaceBySlug('logcheck');
        const db = ws!.placement.data.database!;
        await admin.query(`ALTER DATABASE ${db} SET log_statement = 'all'`);
        await admin.query(`ALTER DATABASE ${db} SET log_parameter_max_length = -1`);
        const from = statSync(PG_LOG).size;

        // A full tour of everything that carries free text.
        await owner.post('/api/w/logcheck/rate-cards', RATES);
        const person = await owner.post('/api/w/logcheck/people', {
          name: 'ZZSENTINELNAME',
          role: 'consumer',
          contact: 'ZZSENTINELCONTACT +91 98200 00000',
          activeFrom: '2026-10-01',
        });
        const pid = person.json.id as string;
        const guest = await p.signIn('zzguest@example.org', 'ZZSENTINELGUEST');
        const inv = await owner.post(`/api/w/logcheck/people/${pid}/invite`, {
          email: 'zzguest@example.org',
        });
        await guest.post('/api/invites/accept', { token: (inv.json.link as string).split('#')[1] });
        await guest.post('/api/w/logcheck/log', {
          date: '2026-10-14',
          personId: pid,
          change: 'Leave',
          qty: null,
          note: 'ZZSENTINELNOTE work from home',
        });
        const claim = await guest.post('/api/w/logcheck/claims', {
          consumerId: pid,
          paidAt: '2026-10-20',
          forMonth: '2026-10',
          amount: 500,
          method: 'UPI',
          refNote: 'ZZSENTINELREF',
        });
        await owner.post(
          `/api/w/logcheck/claims/${claim.json.id}/decision`,
          { decision: 'Disputed', note: 'ZZSENTINELWHY' },
          { 'x-acting-as': 'supplier' },
        );
        await owner.post('/api/w/logcheck/settlements', {
          consumerId: pid,
          forMonth: '2026-10',
          type: 'Query',
          note: 'ZZSENTINELSETTLE',
        });
        await owner.post(`/api/w/logcheck/claims/${claim.json.id}/reversal`, {
          reason: 'ZZSENTINELREVERSAL',
        });
        await owner.req('PATCH', `/api/w/logcheck/people/${pid}`, {
          name: 'ZZSENTINELRENAMED',
          contact: 'ZZSENTINELCONTACT2',
        });
        await owner.get('/api/w/logcheck/audit');
        await owner.get('/api/w/logcheck/log?from=2026-10-01&to=2026-10-31');

        // A control: a statement we know carries plaintext does appear, so a silent log would not pass for clean.
        await new pg.Client({ connectionString: ADMIN_URL.replace('/postgres', `/${db}`) })
          .connect()
          .then(async (c) => {
            await c.query(`SELECT 'ZZCONTROLSENTINEL'`);
            await c.end();
          });
        await new Promise((r) => setTimeout(r, 500));

        const fd = openSync(PG_LOG, 'r');
        const size = statSync(PG_LOG).size - from;
        const buf = Buffer.alloc(size);
        readSync(fd, buf, 0, size, from);
        closeSync(fd);
        const log = buf.toString('utf8');

        expect(log).toContain('ZZCONTROLSENTINEL'); // logging is on and the search works
        expect(log).toContain('INSERT INTO person'); // and the application's own statements are in it
        expect(log).toContain('log_entry');
        expect(log).not.toMatch(/ZZSENTINEL(?!OWNER|GUEST)\w*/);
        expect(log).not.toContain('work from home');
        expect(log).not.toContain('98200');
        // The application's own request log says nothing about people either.
        const app = JSON.stringify(p.logs);
        expect(app).not.toMatch(/ZZSENTINEL|zzowner|zzguest|work from home/);
        expect(app).not.toContain('logcheck'); // the workspace is named by a pseudonym there
      } finally {
        await admin.end();
        await p.destroy();
      }
    },
    60_000,
  );
});
