import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CSP, SECURITY_HEADERS } from '../src/security.ts';
import { makePlatform, type TestPlatform } from './support/platform.ts';

describe('what every response carries', () => {
  let p: TestPlatform;
  beforeAll(async () => {
    p = await makePlatform();
  });
  afterAll(async () => p.destroy());

  it('forbids loading anything from another site, framing, and guessing at types', async () => {
    for (const path of ['/api/health', '/api/me', '/api/public/capacity', '/nope']) {
      const r = await p.anonymous().get(path);
      for (const [name, value] of Object.entries(SECURITY_HEADERS))
        expect(r.headers.get(name), `${path} ${name}`).toBe(value);
    }
    expect(CSP).toContain("default-src 'self'");
    expect(CSP).toContain("frame-ancestors 'none'");
    expect(CSP).not.toMatch(/unsafe-|\*|https?:/);
  });

  it('never lets the API be cached', async () => {
    expect((await p.anonymous().get('/api/me')).headers.get('cache-control')).toBe('no-store');
  });

  it('is the same policy the static files get on Cloudflare', () => {
    const file = readFileSync(new URL('../../web/public/_headers', import.meta.url), 'utf8');
    for (const [name, value] of Object.entries(SECURITY_HEADERS))
      expect(file.toLowerCase(), name).toContain(`${name}: ${value}`.toLowerCase());
  });
});
