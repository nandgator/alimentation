import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { TokenSigner } from '../src/auth/session.ts';
import { randomBytes } from '../src/crypto/aead.ts';
import { startMockOidc, type MockOidc } from './support/mockOidc.ts';
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
    const start = await p.runtime.app.request('http://localhost/auth/login?returnTo=/app/namrata');
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
    expect(res.headers.get('location')).toBe('/app/namrata');
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
