import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { TokenSigner } from '../src/auth/session.ts';
import { randomBytes } from '../src/crypto/aead.ts';
import { startMockOidc, type MockOidc, type MockOidcOptions } from './support/mockOidc.ts';
import { makePlatform, type TestPlatform } from './support/platform.ts';

const b64 = () => Buffer.from(randomBytes(32)).toString('base64');

describe('signing in through an identity provider', () => {
  let idp: MockOidc;
  let p: TestPlatform;
  beforeAll(async () => {
    idp = await startMockOidc('client-1', 'secret-1');
    p = await makePlatform(
      {
        OIDC_ISSUER: idp.issuer,
        OIDC_CLIENT_ID: 'client-1',
        OIDC_CLIENT_SECRET: 'secret-1',
        AUTH_DEV: '0',
      },
      { devAuth: false },
    );
    // makePlatform points OIDC at a dead port when devAuth is false; point it at the mock instead.
  });
  afterAll(async () => {
    await p.destroy();
    await idp.close();
  });

  /** Runs the browser's half: follow the redirect, let the provider approve, come back with the code. */
  async function signIn(
    identity: Record<string, unknown>,
    tweak: { state?: string; nonce?: string; audience?: string; dropFlowCookie?: boolean } = {},
  ) {
    const start = await p.runtime.app.request('http://localhost/auth/login?returnTo=/app/maple');
    expect(start.status).toBe(302);
    const to = new URL(start.headers.get('location')!);
    expect(to.origin).toBe(idp.issuer);
    expect(to.searchParams.get('code_challenge_method')).toBe('S256');
    expect(to.searchParams.get('scope')).toContain('openid');
    expect(to.searchParams.get('redirect_uri')).toBe('http://localhost/auth/callback');
    const cookie = start.headers.get('set-cookie')!.split(';')[0]!;
    const code = idp.grant(
      {
        state: to.searchParams.get('state')!,
        nonce: to.searchParams.get('nonce')!,
        challenge: to.searchParams.get('code_challenge')!,
      },
      identity,
      { audience: tweak.audience, nonce: tweak.nonce },
    );
    return p.runtime.app.request(
      `http://localhost/auth/callback?code=${code}&state=${tweak.state ?? to.searchParams.get('state')}`,
      {
        headers: tweak.dropFlowCookie ? {} : { cookie },
      },
    );
  }

  it('completes the flow, creates the account, sets a session and returns where the person was going', async () => {
    const res = await signIn({
      sub: 'sub-1',
      email: 'Priya@Example.org',
      email_verified: true,
      name: 'Priya',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/app/maple');
    const session = res.headers.getSetCookie().find((c) => c.startsWith('session='))!;
    expect(session).toContain('HttpOnly');
    expect(session).toContain('SameSite=Lax');
    const me = await p.runtime.app.request('http://localhost/api/me', {
      headers: { cookie: session.split(';')[0]! },
    });
    expect((await me.json()).account).toMatchObject({ email: 'priya@example.org', name: 'Priya' });
    const again = await signIn({
      sub: 'sub-1',
      email: 'priya@example.org',
      email_verified: true,
      name: 'Priya',
    });
    expect(again.status).toBe(302);
    expect((await p.runtime.deps.control.accountByEmail('priya@example.org'))!.id).toBeTruthy();
  });

  it('refuses an unverified email, a token for another sign-in, another audience, and a lost or wrong state', async () => {
    const ok = { sub: 'sub-2', email: 'x@example.org', name: 'X' };
    expect((await signIn({ ...ok, email_verified: false })).status).toBe(400);
    expect(
      (await signIn({ ...ok, email_verified: true }, { nonce: 'someone-elses-nonce' })).status,
    ).toBe(400);
    expect(
      (await signIn({ ...ok, email_verified: true }, { audience: 'another-client' })).status,
    ).toBe(400);
    expect((await signIn({ ...ok, email_verified: true }, { state: 'forged' })).status).toBe(400);
    expect((await signIn({ ...ok, email_verified: true }, { dropFlowCookie: true })).status).toBe(
      400,
    );
    expect((await signIn({ sub: 'sub-3', email_verified: true })).status).toBe(400); // no email shared
    expect(await p.runtime.deps.control.accountByEmail('x@example.org')).toBeUndefined();
  });

  it('never sends a person to another site after signing in', async () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example']) {
      const start = await p.runtime.app.request(
        `http://localhost/auth/login?returnTo=${encodeURIComponent(bad)}`,
      );
      const to = new URL(start.headers.get('location')!);
      const cookie = start.headers.get('set-cookie')!.split(';')[0]!;
      const code = idp.grant(
        {
          state: to.searchParams.get('state')!,
          nonce: to.searchParams.get('nonce')!,
          challenge: to.searchParams.get('code_challenge')!,
        },
        { sub: 'sub-r', email: 'r@example.org', email_verified: true },
      );
      const res = await p.runtime.app.request(
        `http://localhost/auth/callback?code=${code}&state=${to.searchParams.get('state')}`,
        { headers: { cookie } },
      );
      expect(res.headers.get('location')).toBe('/app');
    }
  });

  it('does not let a code be used twice', async () => {
    const start = await p.runtime.app.request('http://localhost/auth/login');
    const to = new URL(start.headers.get('location')!);
    const cookie = start.headers.get('set-cookie')!.split(';')[0]!;
    const code = idp.grant(
      {
        state: to.searchParams.get('state')!,
        nonce: to.searchParams.get('nonce')!,
        challenge: to.searchParams.get('code_challenge')!,
      },
      { sub: 'sub-4', email: 'four@example.org', email_verified: true },
    );
    const url = `http://localhost/auth/callback?code=${code}&state=${to.searchParams.get('state')}`;
    expect((await p.runtime.app.request(url, { headers: { cookie } })).status).toBe(302);
    expect((await p.runtime.app.request(url, { headers: { cookie } })).status).toBe(400);
  });
});

describe('configuration', () => {
  const base = {
    APP_ORIGIN: 'https://alimentation.example',
    SESSION_SECRETS: b64(),
    MASTER_KEYS: `1:${b64()}`,
    CONTROL_DATABASE_URL: 'postgres://x',
    NODE_ENV: 'production',
  };
  const oidc = {
    OIDC_ISSUER: 'https://accounts.example',
    OIDC_CLIENT_ID: 'a',
    OIDC_CLIENT_SECRET: 'b',
  };

  it('refuses development sign-in in production, plain http in production, and a server nobody can sign in to', () => {
    expect(() => loadConfig({ ...base, ...oidc, AUTH_DEV: '1' })).toThrow(/refused in production/);
    expect(() =>
      loadConfig({ ...base, ...oidc, APP_ORIGIN: 'http://alimentation.example' }),
    ).toThrow(/https/);
    expect(() => loadConfig({ ...base })).toThrow(/OIDC_ISSUER/);
    expect(loadConfig({ ...base, ...oidc }).secure).toBe(true);
    expect(
      loadConfig({
        ...base,
        NODE_ENV: 'development',
        APP_ORIGIN: 'http://localhost:8787',
        AUTH_DEV: '1',
      }).authDev,
    ).toBe(true);
  });

  it('lets a host change the free-tier numbers without a release', () => {
    const c = loadConfig({
      ...base,
      ...oidc,
      FREE_LIMITS_JSON: '{"people":40}',
      CAPACITY_JSON: '{"hostProjects":300}',
    });
    expect(c.freeLimits).toMatchObject({ people: 40, requestsPerDay: 1000 });
    expect(c.capacity.hostProjects).toBe(300);
  });

  it('normalises operator emails', () => {
    expect([
      ...loadConfig({ ...base, ...oidc, OPERATOR_EMAILS: ' A@x.org , b@x.org ' }).operators,
    ]).toEqual(['a@x.org', 'b@x.org']);
  });
});

describe('signed tokens', () => {
  const now = new Date('2026-10-24T06:00:00Z');
  it('verify while fresh and not after, and reject another key, a changed body and junk', async () => {
    const a = await TokenSigner.fromSecrets([b64()]);
    const b = await TokenSigner.fromSecrets([b64()]);
    const t = await a.sign({ a: 'one' }, 60, now);
    expect((await a.verify<{ a: string }>(t, now))!.a).toBe('one');
    expect(await a.verify(t, new Date(now.getTime() + 61_000))).toBeNull();
    expect(await b.verify(t, now)).toBeNull();
    const [body, mac] = t.split('.');
    expect(await a.verify(`${body}A.${mac}`, now)).toBeNull();
    for (const junk of ['', 'x', '.', 'a.b', 'a'.repeat(5000), null, undefined])
      expect(await a.verify(junk as never, now)).toBeNull();
  });

  it('rotate: the newest key signs, the older ones still verify', async () => {
    const oldSecret = b64();
    const old = await TokenSigner.fromSecrets([oldSecret]);
    const t = await old.sign({ a: 'one' }, 60, now);
    const rotated = await TokenSigner.fromSecrets([b64(), oldSecret]);
    expect(await rotated.verify(t, now)).not.toBeNull();
    expect(await old.verify(await rotated.sign({ a: 'two' }, 60, now), now)).toBeNull();
  });

  it('refuses a short secret and none at all', async () => {
    await expect(
      TokenSigner.fromSecrets([Buffer.from('short').toString('base64')]),
    ).rejects.toThrow(/32 bytes/);
    await expect(TokenSigner.fromSecrets([])).rejects.toThrow(/no session secret/);
  });
});

/** The browser's half of a sign-in, against whichever provider is given: start, approve, come back. */
async function walk(
  p: TestPlatform,
  idp: MockOidc,
  identity: Record<string, unknown>,
  grant: Parameters<MockOidc['grant']>[2] = {},
) {
  const start = await p.runtime.app.request('http://localhost/auth/login');
  const to = new URL(start.headers.get('location')!);
  const cookie = start.headers.get('set-cookie')!.split(';')[0]!;
  const code = idp.grant(
    {
      state: to.searchParams.get('state')!,
      nonce: to.searchParams.get('nonce')!,
      challenge: to.searchParams.get('code_challenge')!,
    },
    identity,
    grant,
  );
  const back = await p.runtime.app.request(
    `http://localhost/auth/callback?code=${code}&state=${to.searchParams.get('state')}`,
    { headers: { cookie } },
  );
  return { to, back };
}

async function against(
  options: MockOidcOptions,
  secret = 'secret-1',
): Promise<{ idp: MockOidc; p: TestPlatform; done: () => Promise<void> }> {
  const idp = await startMockOidc('client-1', secret, options);
  const p = await makePlatform(
    {
      OIDC_ISSUER: idp.issuer,
      OIDC_CLIENT_ID: 'client-1',
      OIDC_CLIENT_SECRET: secret,
      AUTH_DEV: '0',
    },
    { devAuth: false },
  );
  return {
    idp,
    p,
    done: async () => {
      await p.destroy();
      await idp.close();
    },
  };
}

describe('signing in with a provider that keeps the email out of the identity token', () => {
  // Authelia and Zitadel do, unless they are told otherwise: the claims are for the userinfo endpoint.
  let k: Awaited<ReturnType<typeof against>>;
  beforeAll(async () => (k = await against({ userinfo: true })));
  afterAll(() => k.done());

  const who = { sub: 'u-1', email: 'Asha@Example.org', email_verified: true, name: 'Asha' };

  it('asks the userinfo endpoint, and signs in with what it says', async () => {
    const before = k.idp.userinfoCalls;
    const { back } = await walk(k.p, k.idp, who, {
      onlyInUserinfo: ['email', 'email_verified', 'name'],
    });
    expect(back.status).toBe(302);
    expect(k.idp.userinfoCalls).toBe(before + 1);
    const account = await k.p.runtime.deps.control.accountByEmail('asha@example.org');
    expect(account).toMatchObject({ displayName: 'Asha' });
  });

  it('asks only for what the identity token left out', async () => {
    const { back } = await walk(
      k.p,
      k.idp,
      { sub: 'u-2', email: 'only-verified@example.org', email_verified: true },
      { onlyInUserinfo: ['email_verified'] },
    );
    expect(back.status).toBe(302);
    expect(await k.p.runtime.deps.control.accountByEmail('only-verified@example.org')).toBeTruthy();
  });

  it('does not ask when the identity token has it all', async () => {
    const before = k.idp.userinfoCalls;
    const { back } = await walk(k.p, k.idp, {
      sub: 'u-3',
      email: 'all@example.org',
      email_verified: true,
    });
    expect(back.status).toBe(302);
    expect(k.idp.userinfoCalls).toBe(before);
  });

  it('still refuses an email the provider does not vouch for, wherever it says so', async () => {
    const { back } = await walk(
      k.p,
      k.idp,
      { sub: 'u-4', email: 'unvouched@example.org', email_verified: false },
      { onlyInUserinfo: ['email', 'email_verified'] },
    );
    expect(back.status).toBe(400);
    expect(await k.p.runtime.deps.control.accountByEmail('unvouched@example.org')).toBeUndefined();
  });

  it('refuses an answer about someone else, and a verified flag that belongs to another email', async () => {
    const other = await walk(
      k.p,
      k.idp,
      { sub: 'u-5', email: 'swapped@example.org', email_verified: true },
      { onlyInUserinfo: ['email', 'email_verified'], userinfoSub: 'someone-else' },
    );
    expect(other.back.status).toBe(400);
    expect(await k.p.runtime.deps.control.accountByEmail('swapped@example.org')).toBeUndefined();

    // The token names one address; the userinfo says another is verified. The first is not vouched for.
    const { back } = await walk(
      k.p,
      k.idp,
      { sub: 'u-6', email: 'named@example.org', email_verified: true },
      { onlyInUserinfo: ['email_verified'] },
    );
    expect(back.status).toBe(302); // the same address, so it is the one vouched for
    const mismatch = await walk(k.p, k.idp, { sub: 'u-7', email: 'claimed@example.org' });
    expect(mismatch.back.status).toBe(400); // nothing says it is verified
  });
});

describe('signing in with a provider that has no userinfo endpoint', () => {
  let k: Awaited<ReturnType<typeof against>>;
  beforeAll(async () => (k = await against({})));
  afterAll(() => k.done());

  it('says the provider shared no email, when the identity token has none', async () => {
    const { back } = await walk(
      k.p,
      k.idp,
      { sub: 'n-1', email: 'gone@example.org', email_verified: true },
      {
        onlyInUserinfo: ['email'],
      },
    );
    expect(back.status).toBe(400);
    expect(await back.json()).toMatchObject({ error: { code: 'sign_in_failed' } });
  });
});

describe('how the app proves itself to the token endpoint', () => {
  const who = { sub: 'a-1', email: 'auth@example.org', email_verified: true };

  it('sends the secret in the body, as it always has, when the provider does not say', async () => {
    const k = await against({ registeredAs: 'post' });
    try {
      expect((await walk(k.p, k.idp, who)).back.status).toBe(302);
      expect(k.idp.lastAuth).toBe('post');
    } finally {
      await k.done();
    }
  });

  it('keeps to the body when the provider takes either', async () => {
    const k = await against({
      advertise: ['client_secret_basic', 'client_secret_post'],
      registeredAs: 'post',
    });
    try {
      expect((await walk(k.p, k.idp, who)).back.status).toBe(302);
      expect(k.idp.lastAuth).toBe('post');
    } finally {
      await k.done();
    }
  });

  it('uses HTTP Basic when that is the only way the provider takes it', async () => {
    const k = await against({ advertise: ['client_secret_basic'], registeredAs: 'basic' });
    try {
      expect((await walk(k.p, k.idp, who)).back.status).toBe(302);
      expect(k.idp.lastAuth).toBe('basic');
    } finally {
      await k.done();
    }
  });

  it('encodes the two halves of a Basic credential before joining them, so a colon or a percent sign survives', async () => {
    const secret = 'se:cr/et%+ü 1';
    const k = await against({ advertise: ['client_secret_basic'], registeredAs: 'basic' }, secret);
    try {
      expect((await walk(k.p, k.idp, who)).back.status).toBe(302);
    } finally {
      await k.done();
    }
  });
});

describe('asking the provider to let the person choose an account', () => {
  it('asks, unless the provider says it does not understand that', async () => {
    const plain = await against({});
    const strict = await against({ promptValues: ['none', 'login', 'consent'] });
    const knows = await against({ promptValues: ['none', 'login', 'consent', 'select_account'] });
    try {
      for (const [k, expected] of [
        [plain, 'select_account'],
        [strict, null],
        [knows, 'select_account'],
      ] as const) {
        const { to } = await walk(k.p, k.idp, {
          sub: 'p-1',
          email: 'p@example.org',
          email_verified: true,
        });
        expect(to.searchParams.get('prompt')).toBe(expected);
      }
    } finally {
      await plain.done();
      await strict.done();
      await knows.done();
    }
  });
});
