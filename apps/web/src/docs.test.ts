/// <reference types="node" />
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_POLICY, FREE_LIMITS } from '@alimentation/core';
import { describe, expect, it } from 'vitest';
import { buildDocs } from '../scripts/build-docs.mjs';

const REPO_SITE = join(import.meta.dirname, '..', '..', '..', 'docs', 'site');
const read = (file: string) => readFileSync(join(REPO_SITE, file), 'utf8');
const listed = (dir: string) =>
  (JSON.parse(read(`${dir}/nav.json`)) as { sections: { pages: string[] }[] }).sections.flatMap(
    (s) => s.pages,
  );

/** A built web app, as far as the documentation needs one: an index page that names the stylesheet. */
function fakeDist(): string {
  const dist = mkdtempSync(join(tmpdir(), 'alim-dist-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(
    join(dist, 'index.html'),
    '<!doctype html><html><head><link rel="stylesheet" href="/assets/index-test.css"></head></html>',
  );
  return dist;
}

const page = (title: string, body: string) =>
  `---\ntitle: ${title}\ndescription: About ${title}.\n---\n\n# ${title}\n\n${body}\n`;
const nav = (...slugs: string[]) => ({ title: 't', sections: [{ title: 'All', pages: slugs }] });

/** A small documentation source with both sites, for the checks that need something wrong in it. */
function smallSite(
  guides: Record<string, string>,
  docs: Record<string, string>,
  navs: { guides?: object; docs?: object } = {},
): string {
  const src = mkdtempSync(join(tmpdir(), 'alim-site-'));
  const put = (dir: string, pages: Record<string, string>, n: object) => {
    mkdirSync(join(src, dir), { recursive: true });
    writeFileSync(join(src, dir, 'nav.json'), JSON.stringify(n));
    for (const [file, text] of Object.entries(pages)) {
      mkdirSync(join(src, dir, file, '..'), { recursive: true });
      writeFileSync(join(src, dir, file), text);
    }
  };
  put(
    'guides',
    guides,
    navs.guides ?? nav(...Object.keys(guides).map((f) => f.replace(/\.md$/, ''))),
  );
  put('docs', docs, navs.docs ?? nav(...Object.keys(docs).map((f) => f.replace(/\.md$/, ''))));
  return src;
}
const ok = { 'index.md': page('Home', 'a') };

describe('the documentation sites', () => {
  const dist = fakeDist();
  const built = buildDocs({ dist });
  const html = (url: string) => readFileSync(join(dist, url, 'index.html'), 'utf8');
  const site = (dir: string) => built.sites.find((s) => s.dir === dir)!;

  it('builds two sites, the guides for people and the docs for technicians, each from its own navigation', () => {
    expect(built.sites.map((s) => s.dir)).toEqual(['guides', 'docs']);
    for (const dir of ['guides', 'docs']) {
      expect(site(dir).pages, dir).toHaveLength(listed(dir).length);
      expect(site(dir).pages[0]).toBe(`/${dir}/`);
    }
    expect(built.pages).toHaveLength(listed('guides').length + listed('docs').length);
  });

  it('gives every page one title, one heading and the app’s own stylesheet', () => {
    for (const url of built.pages) {
      const h = html(url);
      expect(h.match(/<h1 /g), url).toHaveLength(1);
      expect(h).toContain('<link rel="stylesheet" href="/assets/index-test.css">');
      expect(h).toMatch(/<title>[^<]+<\/title>/);
      expect(h).toMatch(/<meta name="description" content="[^"]+">/);
    }
  });

  it('is built for a strict content-security policy: no inline script, no inline style, nothing from elsewhere', () => {
    for (const url of built.pages) {
      const h = html(url);
      expect(h, url).not.toMatch(/<script(?![^>]*\ssrc=)/);
      expect(h, url).not.toMatch(/<[a-z][^>]*\sstyle=/i);
      expect(h, url).not.toMatch(/<[a-z][^>]*\son[a-z]+=/i);
      expect(h, url).not.toMatch(/(?:src|href)="https?:\/\/(?!github\.com)/);
    }
  });

  it('marks the current page, and the site it is in, and links to the other site', () => {
    for (const url of built.pages) {
      const h = html(url);
      expect(h.match(/aria-current="page"/g), url).toHaveLength(1);
      const dir = url.split('/')[1]!;
      const switcher = /<nav class="docs-switch"[^>]*>(.*?)<\/nav>/.exec(h)![1]!;
      expect(switcher, url).toContain(`<a href="/${dir}/" aria-current="true">`);
      expect(switcher.match(/aria-current/g), url).toHaveLength(1);
      expect(switcher, url).toContain('href="/guides/"');
      expect(switcher, url).toContain('href="/docs/"');
      const ids = [...h.matchAll(/<h[1-6] id="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size, url).toBe(ids.length);
    }
  });

  it('writes a search index for each site with one entry per page of that site only', () => {
    for (const dir of ['guides', 'docs']) {
      const index = JSON.parse(readFileSync(join(dist, dir, 'search-index.json'), 'utf8')) as {
        t: string;
        u: string;
        x: string;
      }[];
      expect(index.map((e) => e.u).sort(), dir).toEqual([...site(dir).pages].sort());
      expect(index.every((e) => e.t && e.x.length > 100)).toBe(true);
      expect(html(`/${dir}/`)).toContain(`data-index="/${dir}/search-index.json"`);
    }
  });

  it('shares one stylesheet and two scripts between the sites', () => {
    expect(readdirSync(join(dist, 'doc-assets')).sort()).toEqual([
      'docs.css',
      'docs.js',
      'theme.js',
    ]);
    for (const url of built.pages) {
      const h = html(url);
      expect(h).toContain('href="/doc-assets/docs.css"');
      expect(h).toContain('src="/doc-assets/docs.js"');
    }
  });

  it('turns a note, a tip and a warning into callouts and a table into a region that can be scrolled', () => {
    expect(html('/docs/concepts/trust-model/')).toContain(
      'class="tablewrap" tabindex="0" role="region"',
    );
    expect(html('/guides/start/roles/')).toContain('callout callout-warning');
    expect(html('/guides/')).toContain('callout callout-note');
    expect(html('/guides/start/quickstart/')).toContain('callout callout-tip');
    expect(html('/docs/self-hosting/going-live/')).toContain('class="tick"');
  });

  it('keeps each audience in its own place: no jargon in the guides, and a way across to the docs', () => {
    const jargon =
      /\b(postgres(ql)?|sql|api|docker|npm|oidc|cli|tls|checksum|endpoint|environment variables?|row-level)\b/i;
    for (const url of site('guides').pages) {
      const text = html(url).replace(/<(pre|code|nav|header|footer)[\s\S]*?<\/\1>/g, ' ');
      expect(text.replace(/<[^>]+>/g, ' '), url).not.toMatch(jargon);
    }
    expect(html('/guides/fair/your-data/')).toContain('href="/docs/lifecycle/bundle-and-move/"');
    expect(html('/guides/')).toContain('href="/docs/"');
    expect(html('/docs/')).toContain('href="/guides/"');
  });
});

describe('the documentation build refuses what would let a reader down', () => {
  const dist = fakeDist();
  const build = (
    guides: Record<string, string>,
    docs: Record<string, string> = ok,
    navs: { guides?: object; docs?: object } = {},
  ) => buildDocs({ src: smallSite(guides, docs, navs), dist });

  it('builds a small pair of sites, and lets a page in one link to the other', () => {
    const r = build(
      { 'index.md': page('Home', 'See [the technical side](/docs/other/#part).') },
      { 'index.md': page('Home', 'a'), 'other.md': page('Other', '## Part\n\nx') },
    );
    expect(r.sites.map((s) => s.pages)).toEqual([['/guides/'], ['/docs/', '/docs/other/']]);
  });

  it('fails on a link to a page that is not there, and on a section that is not there', () => {
    expect(() => build({ 'index.md': page('Home', '[x](/guides/gone/)') })).toThrow(
      /\/guides\/gone\/ is not a page/,
    );
    expect(() => build({ 'index.md': page('Home', '[x](/docs/gone/)') })).toThrow(
      /\/docs\/gone\/ is not a page/,
    );
    expect(() =>
      build(
        { 'index.md': page('Home', '[x](/guides/other/#nope)'), 'other.md': page('Other', 'y') },
        ok,
        { guides: nav('index', 'other') },
      ),
    ).toThrow(/no such section/);
    expect(() => build({ 'index.md': page('Home', '[x](#nope)') })).toThrow(/no section "#nope"/);
  });

  it('fails on a page nobody can reach, a page listed twice, and a page that is missing', () => {
    expect(() =>
      build({ 'index.md': page('Home', 'a'), 'lost.md': page('Lost', 'b') }, ok, {
        guides: nav('index'),
      }),
    ).toThrow(/guides\/lost\.md is not in guides\/nav\.json/);
    expect(() => build(ok, ok, { docs: nav('index', 'index') })).toThrow(
      /docs\/nav\.json lists index twice/,
    );
    expect(() => build(ok, ok, { guides: nav('index', 'ghost') })).toThrow(
      /guides\/ghost\.md, which does not exist/,
    );
  });

  it('fails on a page with no title, two pages with one title, or no heading', () => {
    expect(() => build({ 'index.md': '# Home\n\nx\n' })).toThrow(/front matter/);
    expect(() =>
      build({ 'index.md': page('Same', 'a'), 'b.md': page('Same', 'b') }, ok, {
        guides: nav('index', 'b'),
      }),
    ).toThrow(/two pages in guides are called "Same"/);
    expect(() =>
      build({ 'index.md': '---\ntitle: T\ndescription: D\n---\n\njust text\n' }),
    ).toThrow(/starts with one # heading/);
  });

  it('needs the web app built first', () => {
    const empty = mkdtempSync(join(tmpdir(), 'alim-empty-'));
    expect(() => buildDocs({ src: smallSite(ok, ok), dist: empty })).toThrow(
      /run the web build first/,
    );
  });
});

describe('what the documentation says is still what the app does', () => {
  it('states the free-tier numbers the app enforces', () => {
    const text = read('guides/fair/free-tier.md');
    const n = (v: number) => v.toLocaleString('en-US');
    const row = (label: string, value: string) =>
      new RegExp(`\\|\\s*\\*\\*${label}\\*\\*\\s*\\|\\s*${value}`);
    expect(text).toMatch(row('People', n(FREE_LIMITS.people)));
    expect(text).toMatch(row('Entries', n(FREE_LIMITS.rows)));
    expect(text).toMatch(row('Actions a day', `${n(FREE_LIMITS.requestsPerDay)},`));
    expect(text).toMatch(row('Storage', `${FREE_LIMITS.bytes / 1024 / 1024} MB`));
  });

  it('states the defaults a new kitchen starts with', () => {
    const rules = read('guides/admin/kitchen-rules.md');
    expect(DEFAULT_POLICY.workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(rules).toMatch(/Working days\*\*\s+\|[^|]+\|\s*Monday to Friday/);
    expect(DEFAULT_POLICY.holidays.count).toBe('confirmed');
    expect(rules).toMatch(/Holidays that cancel a meal\*\*\s+\|[^|]+\|\s*Only confirmed/);
    expect(DEFAULT_POLICY.leave.chargeBps).toBe(0);
    expect(rules).toMatch(/Charge on a leave day\*\*\s+\|[^|]+\|\s*0 percent/);
    expect(DEFAULT_POLICY.extras).toEqual({ minMeals: 1 });
    expect(DEFAULT_POLICY.payments).toBe('claim_confirm');
    expect(DEFAULT_POLICY.monthClose).toEqual({ mode: 'manual', afterClose: 'flag' });
    expect(rules).toMatch(/Month close\*\*\s+\|[^|]+\|\s*Closed by the admin/);
    expect(rules).toMatch(/Entries after close\*\*\s+\|[^|]+\|\s*Allowed, and flagged/);
    expect(DEFAULT_POLICY.rateCards.backdating).toBe('current_month');
    expect(rules).toMatch(/Rate cards may start\*\*\s+\|[^|]+\|\s*From the start of this month/);
    expect(DEFAULT_POLICY.exceptionCutoff).toBeNull();
    expect(rules).toMatch(/Exceptions due\*\*\s+\|[^|]+\|\s*None\s/);
  });

  it('works the month in the billing page out to the figure it prints', () => {
    // 14 veg at 120, 9 non-veg at 150, 30 of extras; a Friday leave, a Tuesday switched, two chapatis.
    const base = 14 * 120 + 9 * 150 + 30;
    expect(base).toBe(3060);
    expect(base - 150 + 30 + 20).toBe(2960);
    const text = read('guides/how/bills.md');
    expect(text).toContain('₹3,060');
    expect(text).toContain('₹2,960');
  });

  it('lists every setting the server reads, in the configuration page', () => {
    const config = readFileSync(
      join(import.meta.dirname, '..', '..', 'api', 'src', 'config.ts'),
      'utf8',
    );
    const schema = /const Env = z\.object\(\{([\s\S]*?)\n\}\);/.exec(config)![1]!;
    const names = [...schema.matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(10);
    const page = read('docs/self-hosting/configuration.md');
    for (const name of names) expect(page, name).toContain(`\`${name}\``);
  });

  it('lists every route the server answers, in the API reference', () => {
    const app = readFileSync(join(import.meta.dirname, '..', '..', 'api', 'src', 'app.ts'), 'utf8');
    const paths = [
      ...app.matchAll(/\b(?:app|w)\.(?:get|post|put|patch|delete)\(\s*'([^']+)'/g),
    ].map((m) => m[1]!);
    expect(paths.length).toBeGreaterThan(40);
    const pages = ['overview', 'workspace', 'platform']
      .map((n) => read(`docs/api/${n}.md`))
      .join('\n');
    for (const path of paths) expect(pages, path).toContain(path);
  });

  it('names every command the command line offers', () => {
    const cli = readFileSync(join(import.meta.dirname, '..', '..', 'api', 'src', 'cli.ts'), 'utf8');
    const commands = [...cli.matchAll(/case '([a-z]+:?[a-z]*)':/g)].map((m) => m[1]!);
    expect(commands.length).toBeGreaterThanOrEqual(6);
    const page = read('docs/self-hosting/cli.md');
    for (const c of commands) expect(page, c).toContain(`\`${c}\``);
  });
});
