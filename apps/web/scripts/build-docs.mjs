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
      checkbox({ checked }) {
        return `<span class="tick" aria-hidden="true">${checked ? '&#9745;' : '&#9744;'}</span> `;
      },
    },
  });
  return md;
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
      const html = renderer(toc).parse(body);
      if (!/^<h1 /.test(html)) throw new Error(`${file}: a page starts with one # heading`);
      pages.push({
        site,
        slug,
        file,
        section: section.title,
        title: meta.title,
        description: meta.description,
        url: slug === 'index' ? site.base : `${site.base}${slug}/`,
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

function navHtml(site, current) {
  return site.sections
    .map(
      (s) =>
        `<div class="docs-group" role="group" aria-label="${esc(s.title)}"><p class="docs-group-title" aria-hidden="true">${esc(s.title)}</p>${s.pages
          .map((slug) => {
            const p = site.pages.find((x) => x.slug === slug);
            return `<a href="${p.url}"${p.slug === current.slug ? ' aria-current="page"' : ''}>${esc(p.title)}</a>`;
          })
          .join('')}</div>`,
    )
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
<script src="${ASSETS}theme.js"></script>
<script src="${ASSETS}docs.js" defer></script>
</head>
<body class="docs site-${meta.dir}">
<a class="skip" href="#content">Skip to the page</a>
<header class="docs-top">
  <div class="docs-top-in">
    <button type="button" class="docs-menu" aria-expanded="false" aria-controls="docs-nav">Menu</button>
    <a class="docs-brand" href="${meta.base}"><img src="/favicon.svg" alt="" width="26" height="26"><span>Alimentation <b>${meta.brand}</b></span></a>
    ${switcher}
    <div class="docs-search" role="search">
      <label class="sr" for="docs-q">Search the ${meta.brand}</label>
      <input id="docs-q" type="search" placeholder="Search the ${meta.brand}" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="docs-results" aria-autocomplete="list" data-index="${meta.base}search-index.json">
      <ul id="docs-results" class="docs-results" role="listbox" aria-label="Search results" hidden></ul>
    </div>
    <span class="grow"></span>
    <button type="button" class="docs-theme btn ghost small" aria-label="Switch colour theme">Theme</button>
    <a class="btn small docs-open" href="/app">Open the app</a>
  </div>
</header>
<div class="docs-shell">
  <nav id="docs-nav" class="docs-nav" aria-label="${esc(meta.name)} contents">${navHtml(site, page)}</nav>
  <main id="content" class="docs-main" tabindex="-1">
    <article class="docs-article">
      <p class="docs-crumb">${esc(page.section)}</p>
${page.html}
      ${pager}
    </article>
    <footer class="docs-foot"><p class="muted small">Alimentation keeps the accounts of small kitchens. <a href="/">Home</a> · <a href="/app">Open the app</a> · <a href="${SITES.find((x) => x.dir !== meta.dir).base}">${SITES.find((x) => x.dir !== meta.dir).name}</a></p></footer>
  </main>
  ${toc}
</div>
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
  for (const f of ['docs.css', 'docs.js', 'theme.js'])
    cpSync(join(here, 'docs', f), join(assets, f));
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
