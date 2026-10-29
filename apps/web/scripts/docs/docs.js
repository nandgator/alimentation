// The documentation's few moving parts: the menu on a phone, the theme, copy buttons, the contents'
// current section, and search. Every page works without this file.
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  // --- the menu on a narrow screen
  const menu = $('.docs-menu');
  const nav = $('.docs-nav');
  if (menu && nav) {
    menu.addEventListener('click', () => {
      const open = nav.dataset.open !== 'true';
      nav.dataset.open = String(open);
      menu.setAttribute('aria-expanded', String(open));
    });
  }

  // --- the theme: the system's unless the reader has chosen. The same choice, under the same key, as the
  // app's, so it applies to every page (the app's own control is in src/theme.ts).
  const themeButton = $('.docs-theme');
  const ORDER = ['auto', 'light', 'dark'];
  const NAMES = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  const chosen = () => {
    try {
      const t = localStorage.getItem('theme') || localStorage.getItem('docs-theme');
      return t === 'light' || t === 'dark' ? t : 'auto';
    } catch {
      return document.documentElement.dataset.theme || 'auto';
    }
  };
  const labelTheme = (t) => {
    if (!themeButton) return;
    themeButton.textContent = 'Theme: ' + NAMES[t];
    themeButton.setAttribute(
      'aria-label',
      'Colour theme: ' + NAMES[t].toLowerCase() + '. Press to change.',
    );
  };
  if (themeButton) {
    labelTheme(chosen());
    themeButton.addEventListener('click', () => {
      const next = ORDER[(ORDER.indexOf(chosen()) + 1) % ORDER.length];
      try {
        localStorage.removeItem('docs-theme');
        if (next === 'auto') localStorage.removeItem('theme');
        else localStorage.setItem('theme', next);
      } catch {
        // The choice lasts for this page only.
      }
      // Kept at once, shown as a dissolve (public/theme.js) where the browser can.
      const show = () => {
        if (next === 'auto') delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = next;
        labelTheme(next);
      };
      if (window.fadeTheme) window.fadeTheme(show);
      else show();
    });
  }

  // --- copy buttons on code
  for (const pre of document.querySelectorAll('pre')) {
    const code = $('code', pre);
    if (!code) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'copy';
    b.textContent = 'Copy';
    b.setAttribute('aria-label', 'Copy this code');
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent ?? '');
        b.textContent = 'Copied';
      } catch {
        b.textContent = 'Select and copy';
      }
      setTimeout(() => (b.textContent = 'Copy'), 1800);
    });
    pre.append(b);
  }

  // --- which section of the page you are in
  const links = [...document.querySelectorAll('.docs-toc a')];
  if (links.length && 'IntersectionObserver' in window) {
    const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          for (const a of links) a.removeAttribute('aria-current');
          byId.get(e.target.id)?.setAttribute('aria-current', 'true');
        }
      },
      { rootMargin: '-72px 0px -70% 0px' },
    );
    for (const id of byId.keys()) {
      const h = document.getElementById(id);
      if (h) io.observe(h);
    }
  }

  // --- search
  const input = $('#docs-q');
  const list = $('#docs-results');
  if (!input || !list) return;
  let index = null;
  const load = () =>
    (index ??= fetch(input.dataset.index ?? '/docs/search-index.json')
      .then((r) => r.json())
      .then((rows) => rows.map((r) => ({ ...r, lx: r.x.toLowerCase() })))
      .catch(() => []));
  let active = -1;

  const close = () => {
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const select = (i) => {
    const items = [...list.children];
    if (!items.length) return;
    active = (i + items.length) % items.length;
    items.forEach((li, n) => li.setAttribute('aria-selected', String(n === active)));
    input.setAttribute('aria-activedescendant', items[active].id);
    items[active].scrollIntoView({ block: 'nearest' });
  };
  const score = (row, terms) => {
    let s = 0;
    const title = row.t.toLowerCase();
    for (const t of terms) {
      let hit = false;
      if (title.includes(t)) ((s += 10), (hit = true));
      if (row.h.some((h) => h.toLowerCase().includes(t))) ((s += 4), (hit = true));
      if (row.d.toLowerCase().includes(t)) ((s += 2), (hit = true));
      if (row.lx.includes(t)) ((s += 1), (hit = true));
      if (!hit) return 0;
    }
    return s;
  };
  const snippet = (row, terms) => {
    const at = Math.min(...terms.map((t) => row.lx.indexOf(t)).filter((n) => n >= 0), Infinity);
    if (!Number.isFinite(at)) return row.d;
    const from = Math.max(0, at - 50);
    return `${from > 0 ? '...' : ''}${row.x.slice(from, from + 130)}...`;
  };
  const render = (rows, terms) => {
    list.replaceChildren();
    if (!rows.length) {
      const li = document.createElement('li');
      li.className = 'none';
      li.textContent = 'Nothing found. Try a shorter word.';
      list.append(li);
    }
    rows.forEach((row, n) => {
      const li = document.createElement('li');
      li.id = `docs-r${n}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      const a = document.createElement('a');
      a.href = row.u;
      const t = document.createElement('strong');
      t.textContent = row.t;
      const where = document.createElement('span');
      where.className = 'where';
      where.textContent = row.s;
      const s = document.createElement('span');
      s.className = 'snip';
      s.textContent = snippet(row, terms);
      a.append(t, where, s);
      li.append(a);
      list.append(li);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    active = -1;
  };
  const run = async () => {
    const terms = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return close();
    const rows = await load();
    const found = rows
      .map((r) => [score(r, terms), r])
      .filter(([s]) => s > 0)
      .sort((a, b) => b[0] - a[0])
      .slice(0, 8)
      .map(([, r]) => r);
    render(found, terms);
  };
  input.addEventListener('input', () => void run());
  input.addEventListener('focus', () => void load());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), select(active + 1));
    else if (e.key === 'ArrowUp') (e.preventDefault(), select(active - 1));
    else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      $('a', list.children[active])?.click();
    } else if (e.key === 'Escape') {
      close();
      input.value = '';
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.docs-search')) close();
  });
  document.addEventListener('keydown', (e) => {
    const typing = /^(input|textarea|select)$/i.test(document.activeElement?.tagName ?? '');
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      input.focus();
    }
  });
})();
