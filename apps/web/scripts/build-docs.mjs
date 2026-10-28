// Builds the two documentation sites from docs/site (Markdown) into <dist> as plain static pages:
//
//   docs/site/guides  ->  /guides/   for the people who use a kitchen, by task, in plain words
//   docs/site/docs    ->  /docs/     for whoever runs, extends or audits it, as reference
//
//   node scripts/build-docs.mjs      after `vite build`, so the pages can use the app's own
//                                    stylesheet and fonts, which are named by that build
//
// No framework and nothing at run time but a small script for search and the menu: the pages work
// without it, load nothing from anywhere but the site itself (the content-security policy forbids
// it), and are served by whatever serves the app, so they are hosted wherever the app is.
// The build fails on a broken link, an orphan page, a duplicate address or a missing title.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const here = dirname(fileURLToPath(import.meta.url));

/** The two sites. A page in one may link to a page in the other. */
const SITES = [
  { dir: 'guides', base: '/guides/', name: 'Guides', brand: 'guides' },
  { dir: 'docs', base: '/docs/', name: 'Docs', brand: 'docs' },
];
/** Where the stylesheet and scripts both sites share are put. */
const ASSETS = '/doc-assets/';
const REPO = resolve(here, '..', '..', '..');

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plain = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
const slugify = (s) =>
  plain(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';

function frontMatter(text, file) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) throw new Error(`${file}: missing front matter (title, description)`);
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  for (const k of ['title', 'description'])
    if (!meta[k]) throw new Error(`${file}: front matter needs a ${k}`);
  return { meta, body: text.slice(m[0].length) };
}

// The content-security policy forbids inline style attributes, so alignment is a class.
const cellClass = (align) =>
  align === 'right' ? ' class="r"' : align === 'center' ? ' class="c"' : '';

const CALLOUT = { NOTE: 'Note', TIP: 'Tip', WARNING: 'Warning', IMPORTANT: 'Important' };

/** One Markdown parser per page, so heading ids are unique within the page and collected for its contents. */
function renderer(toc) {
  const used = new Set();
  const md = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        let id = slugify(inner);
        for (let n = 2; used.has(id); n++) id = `${slugify(inner)}-${n}`;
        used.add(id);
        if (depth === 2 || depth === 3) toc.push({ depth, id, text: plain(inner) });
        const anchor =
          depth > 1
            ? `<a class="anchor" href="#${id}" aria-label="Link to this section: ${esc(plain(inner))}">#</a>`
            : '';
        return `<h${depth} id="${id}">${inner}${anchor}</h${depth}>\n`;
      },
      blockquote({ tokens }) {
        const html = this.parser.parse(tokens);
        const m = /^<p>\[!(NOTE|TIP|WARNING|IMPORTANT)\]\s*/.exec(html);
        if (!m) return `<blockquote>${html}</blockquote>\n`;
        const kind = m[1].toLowerCase();
        return `<aside class="callout callout-${kind}"><p class="callout-title">${CALLOUT[m[1]]}</p><p>${html.slice(m[0].length)}</aside>\n`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const external = /^https?:\/\//.test(href);
        return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''}${external ? ' rel="noopener noreferrer"' : ''}>${text}</a>`;
      },
      table(token) {
        const head = token.header
          .map((c) => `<th${cellClass(c.align)}>${this.parser.parseInline(c.tokens)}</th>`)
          .join('');
        const rows = token.rows
          .map(
            (r) =>
              `<tr>${r
                .map((c) => `<td${cellClass(c.align)}>${this.parser.parseInline(c.tokens)}</td>`)
                .join('')}</tr>`,
          )
          .join('');
        return `<div class="tablewrap" tabindex="0" role="region" aria-label="Table; scrolls sideways when it is wider than the screen"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>\n`;
      },
      code({ text, lang }) {
        const cls = lang ? ` class="language-${esc(lang.split(/\s/)[0])}"` : '';
        return `<pre tabindex="0"><code${cls}>${esc(text)}</code></pre>\n`;
      },
      codespan({ text }) {
        // A long path or query may break after its separators, which reads better than breaking mid-word.
        const safe = esc(text);
        const soft =
          text.length > 22
            ? safe.replace(/(&(?:amp|lt|gt|quot|#39);)|([/?,=])/g, (m, ent, ch) =>
                ent ? (ent === '&amp;' ? `${ent}<wbr>` : ent) : `${ch}<wbr>`,
              )
            : safe;
        return `<code>${soft}</code>`;
      },
      checkbox({ checked }) {
        return `<span class="tick" aria-hidden="true">${checked ? '&#9745;' : '&#9744;'}</span> `;
      },
    },
  });
  return md;
}

/**
 * The front page of a site (`layout: home` in its index.md) is a hero and a few cards, as in VitePress, with
 * no menu beside it. What goes in them is in the site's home.json, so a page cannot be built without it.
 */
function readHome(srcRoot, site, file) {
  const path = join(srcRoot, site.dir, 'home.json');
  if (!existsSync(path))
    throw new Error(`${file} is a home page, so ${site.dir}/home.json is needed`);
  const h = JSON.parse(readFileSync(path, 'utf8'));
  const need = (ok, what) => {
    if (!ok) throw new Error(`${site.dir}/home.json: ${what}`);
  };
  const text = (v) => typeof v === 'string' && v.trim().length > 0;
  need(
    h.hero && text(h.hero.name) && text(h.hero.text) && text(h.hero.tagline),
    'the hero needs a name, a text and a tagline',
  );
  need(
    Array.isArray(h.hero.actions) && h.hero.actions.length >= 1 && h.hero.actions.length <= 2,
    'the hero has one or two actions',
  );
  for (const x of h.hero.actions)
    need(
      text(x.text) && text(x.link) && ['brand', 'alt'].includes(x.kind),
      'each action needs text, a link and a kind of "brand" or "alt"',
    );
  need(
    Array.isArray(h.features) && h.features.length >= 3 && h.features.length <= 6,
    'there are three to six feature cards',
  );
  for (const f of h.features)
    need(
      text(f.title) && text(f.details) && text(f.link),
      'each card needs a title, details and a link',
    );
  return h;
}

function homeHtml(h) {
  const actions = h.hero.actions
    .map(
      (x) =>
        `<a class="btn${x.kind === 'alt' ? ' ghost' : ''}" href="${esc(x.link)}">${esc(x.text)}</a>`,
    )
    .join('');
  const cards = h.features
    .map(
      (f) =>
        `<a class="feature" href="${esc(f.link)}"><h2>${esc(f.title)}</h2><p>${esc(f.details)}</p></a>`,
    )
    .join('');
  return `<section class="home-hero"><h1><span class="home-name">${esc(h.hero.name)}</span> <span class="home-text">${esc(h.hero.text)}</span></h1><p class="home-tagline">${esc(h.hero.tagline)}</p><p class="home-actions">${actions}</p></section>
<section class="home-features" aria-label="Where to start">${cards}</section>
`;
}

/** One site's pages in reading order, from its nav.json, each read, rendered and checked. */
function loadSite(srcRoot, site) {
  const src = join(srcRoot, site.dir);
  const nav = JSON.parse(readFileSync(join(src, 'nav.json'), 'utf8'));
  const pages = [];
  const seen = new Set();
  for (const section of nav.sections) {
    for (const slug of section.pages) {
      if (seen.has(slug)) throw new Error(`${site.dir}/nav.json lists ${slug} twice`);
      seen.add(slug);
      const file = `${site.dir}/${slug}.md`;
      if (!existsSync(join(srcRoot, file)))
        throw new Error(`${site.dir}/nav.json lists ${file}, which does not exist`);
      const { meta, body } = frontMatter(readFileSync(join(srcRoot, file), 'utf8'), file);
      const toc = [];
      const rendered = renderer(toc).parse(body);
      const layout = meta.layout ?? 'doc';
      if (layout !== 'doc' && layout !== 'home')
        throw new Error(`${file}: layout is "doc" or "home", not "${layout}"`);
      if (layout === 'home' && slug !== 'index')
        throw new Error(`${file}: only a site's index page can be a home page`);
      let front = '';
      if (layout === 'home') {
        if (/<h1[ >]/.test(rendered))
          throw new Error(`${file}: a home page takes its one heading from the hero`);
        front = homeHtml(readHome(srcRoot, site, file));
      } else if (!/^<h1 /.test(rendered)) {
        throw new Error(`${file}: a page starts with one # heading`);
      }
      const html = front + rendered;
      pages.push({
        site,
        slug,
        file,
        section: section.title,
        title: meta.title,
        description: meta.description,
        url: slug === 'index' ? site.base : `${site.base}${slug}/`,
        layout,
        front,
        body: rendered,
        html,
        toc,
      });
    }
  }
  const onDisk = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else if (e.name.endsWith('.md'))
        onDisk.push(relative(src, join(dir, e.name)).replace(/\\/g, '/'));
    }
  };
  walk(src);
  for (const f of onDisk)
    if (!seen.has(f.replace(/\.md$/, '')))
      throw new Error(`${site.dir}/${f} is not in ${site.dir}/nav.json, so nobody could find it`);
  const titles = new Set();
  for (const p of pages) {
    if (titles.has(p.title)) throw new Error(`two pages in ${site.dir} are called "${p.title}"`);
    titles.add(p.title);
  }
  return { site, title: nav.title, sections: nav.sections, pages };
}

/** Every link to another docs page, and every #fragment, must land somewhere. */
function checkLinks(pages) {
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const problems = [];
  for (const p of pages) {
    const ids = new Set([...p.html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    for (const m of p.html.matchAll(/href="([^"]+)"/g)) {
      const href = m[1].replace(/&amp;/g, '&');
      if (/^(https?:|mailto:)/.test(href)) continue;
      if (href.startsWith('#')) {
        if (!ids.has(href.slice(1))) problems.push(`${p.file}: no section "${href}" on this page`);
        continue;
      }
      if (!SITES.some((x) => href.startsWith(x.base.slice(0, -1)))) continue; // the app and the home page have their own tests
      const [path, frag] = href.split('#');
      const target = byUrl.get(path);
      if (!target) {
        problems.push(`${p.file}: ${href} is not a page`);
        continue;
      }
      if (frag && !new RegExp(` id="${frag}"`).test(target.html))
        problems.push(`${p.file}: ${href} has no such section`);
    }
  }
  if (problems.length)
    throw new Error(`Broken links in the documentation:\n  ${problems.join('\n  ')}`);
}

const searchEntry = (p) => ({
  t: p.title,
  u: p.url,
  s: p.section,
  d: p.description,
  h: p.toc.map((x) => x.text),
  x: plain(p.html).slice(0, 6000),
});

/**
 * The app's badge, drawn in the page and not as an image, so that its tiers can be filled as the page is read (see
 * `.mark-fill` in docs.css): the same tiffin as the mark in the home page's bar, on the brand's own green.
 */
const MARK = `<svg class="docs-mark" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false"><rect width="24" height="24" rx="5.3" class="mark-badge"/><g transform="translate(12 12.4) scale(0.8) translate(-12 -12.5)"><g class="mark-body"><rect x="7" y="2.4" width="10" height="1.8" rx="0.9"/><rect x="8.6" y="3.8" width="1.6" height="3.2"/><rect x="13.8" y="3.8" width="1.6" height="3.2"/><rect x="4.6" y="6.8" width="14.8" height="3" rx="1.5"/><rect x="5.6" y="10.8" width="12.8" height="3.4" rx="1.7"/><rect x="5.6" y="15.2" width="12.8" height="3.4" rx="1.7"/><rect x="5.6" y="19.6" width="12.8" height="3" rx="1.5"/></g><g class="mark-clip"><rect x="3.6" y="7" width="1.8" height="14.4" rx="0.9"/><rect x="18.6" y="7" width="1.8" height="14.4" rx="0.9"/></g><rect class="mark-fill mark-fill-1" x="6.4" y="11.6" width="11.2" height="1.8" rx="0.9"/><rect class="mark-fill mark-fill-2" x="6.4" y="16" width="11.2" height="1.8" rx="0.9"/><rect class="mark-fill mark-fill-3" x="6.4" y="20.3" width="11.2" height="1.6" rx="0.8"/><rect class="mark-fill mark-fill-4" x="5.6" y="7.6" width="12.8" height="1.4" rx="0.7"/></g></svg>`;

function navHtml(site, current) {
  return site.sections
    .map((s) => {
      const links = s.pages
        .map((slug) => {
          const p = site.pages.find((x) => x.slug === slug);
          return `<a href="${p.url}"${p.slug === current.slug ? ' aria-current="page"' : ''}>${esc(p.title)}</a>`;
        })
        .join('');
      // Only the section being read is open: the rest are a heading each, so the contents fit on a screen.
      const open = s.pages.includes(current.slug) ? ' open' : '';
      return `<details class="docs-group"${open}><summary class="docs-group-title">${esc(s.title)}</summary><div class="docs-links">${links}</div></details>`;
    })
    .join('');
}

function pageHtml(site, page, css, index) {
  const { site: meta } = site;
  const prev = site.pages[index - 1];
  const next = site.pages[index + 1];
  const toc = page.toc.length
    ? `<nav class="docs-toc" aria-label="On this page"><p class="docs-group-title" aria-hidden="true">On this page</p>${page.toc
        .map((t) => `<a class="toc-${t.depth}" href="#${t.id}">${esc(t.text)}</a>`)
        .join('')}</nav>`
    : '';
  const pager = `<nav class="docs-pager" aria-label="Previous and next page">${
    prev
      ? `<a class="prev" href="${prev.url}"><span>Previous</span>${esc(prev.title)}</a>`
      : '<span></span>'
  }${next ? `<a class="next" href="${next.url}"><span>Next</span>${esc(next.title)}</a>` : '<span></span>'}</nav>`;
  const title =
    page.slug === 'index'
      ? `Alimentation ${meta.brand}`
      : `${page.title} · Alimentation ${meta.brand}`;
  const switcher = `<nav class="docs-switch" aria-label="Documentation">${SITES.map(
    (x) => `<a href="${x.base}"${x.dir === meta.dir ? ' aria-current="true"' : ''}>${x.name}</a>`,
  ).join('')}</nav>`;
  const home = page.layout === 'home';
  const other = SITES.find((x) => x.dir !== meta.dir);
  const foot = `<footer class="docs-foot"><p class="muted small">Alimentation keeps the accounts of small kitchens. <a href="/">Home</a> · <a href="/app">Open the app</a> · <a href="${other.base}">${other.name}</a></p></footer>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(page.description)}">
<meta name="theme-color" content="#1F4D3A">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${css}">
<link rel="stylesheet" href="${ASSETS}docs.css">
<script src="/theme.js"></script>
<script src="${ASSETS}docs.js" defer></script>
</head>
<body class="docs site-${meta.dir}${home ? ' is-home' : ''}">
<a class="skip" href="#content">Skip to the page</a>
<header class="docs-top">
  <div class="docs-top-in">
    ${home ? '' : '<button type="button" class="docs-menu" aria-expanded="false" aria-controls="docs-nav">Menu</button>'}
    <a class="docs-brand" href="${meta.base}">${MARK}<span>Alimentation <b>${meta.brand}</b></span></a>
    ${switcher}
    <div class="docs-search" role="search">
      <label class="sr" for="docs-q">Search the ${meta.brand}</label>
      <input id="docs-q" type="search" placeholder="Search the ${meta.brand}" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="docs-results" aria-autocomplete="list" data-index="${meta.base}search-index.json">
      <ul id="docs-results" class="docs-results" role="listbox" aria-label="Search results" hidden></ul>
    </div>
    <span class="grow"></span>
    <button type="button" class="docs-theme btn ghost small" aria-label="Colour theme: automatic. Press to change.">Theme: Auto</button>
    <a class="btn small docs-open" href="/app">Open the app</a>
  </div>
</header>
${
  home
    ? `<main id="content" class="docs-home" tabindex="-1">
${page.front}${page.body.trim() ? `<article class="docs-article home-body">\n${page.body}</article>\n` : ''}${foot}
</main>`
    : `<div class="docs-shell">
  <nav id="docs-nav" class="docs-nav" aria-label="${esc(meta.name)} contents">${navHtml(site, page)}</nav>
  <main id="content" class="docs-main" tabindex="-1">
    <article class="docs-article">
      <p class="docs-crumb">${esc(page.section)}</p>
${page.html}
      ${pager}
    </article>
    ${foot}
  </main>
  ${toc}
</div>`
}
</body>
</html>
`;
}

/** The stylesheet the app's build produced, so the pages share its fonts, colours and light and dark modes. */
function appStylesheet(dist) {
  const index = join(dist, 'index.html');
  if (!existsSync(index)) throw new Error(`${index} not found: run the web build first`);
  const m = /href="(\/assets\/[^"]+\.css)"/.exec(readFileSync(index, 'utf8'));
  if (!m) throw new Error('the web build has no stylesheet to share');
  return m[1];
}

export function buildDocs({
  src = join(REPO, 'docs', 'site'),
  dist = join(REPO, 'apps', 'web', 'dist'),
} = {}) {
  const sites = SITES.map((site) => loadSite(src, site));
  checkLinks(sites.flatMap((x) => x.pages));
  const css = appStylesheet(dist);
  const assets = join(dist, ASSETS);
  rmSync(assets, { recursive: true, force: true });
  mkdirSync(assets, { recursive: true });
  for (const f of ['docs.css', 'docs.js']) cpSync(join(here, 'docs', f), join(assets, f));
  const written = [];
  for (const site of sites) {
    const out = join(dist, site.site.dir);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    site.pages.forEach((p, i) => {
      const dir = p.slug === 'index' ? out : join(out, p.slug);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'index.html'), pageHtml(site, p, css, i));
      written.push(p.url);
    });
    writeFileSync(join(out, 'search-index.json'), JSON.stringify(site.pages.map(searchEntry)));
  }
  return {
    pages: written,
    sites: sites.map((x) => ({ dir: x.site.dir, pages: x.pages.map((p) => p.url) })),
    dist,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = buildDocs();
  console.log(
    `documentation: ${r.sites.map((x) => `${x.pages.length} pages in /${x.dir}/`).join(', ')}`,
  );
}
