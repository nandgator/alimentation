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
      'Theme: ' + NAMES[t].toLowerCase() + '. Press to change.',
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

  // --- copy buttons on code: an icon on the bar of the block (the design system's `.code` and `.icon-btn`)
  const NS = 'http://www.w3.org/2000/svg';
  const icon = (name, shapes) => {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', name);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    for (const [tag, attrs] of shapes) {
      const el = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      svg.append(el);
    }
    return svg;
  };
  for (const figure of document.querySelectorAll('figure.code')) {
    const code = $('pre code', figure);
    if (!code) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn copy';
    b.title = 'Copy';
    b.setAttribute('aria-label', 'Copy this code');
    const label = document.createElement('span');
    label.className = 'copy-label';
    label.textContent = 'Copied';
    b.append(
      icon('i-copy', [
        ['rect', { x: 9, y: 9, width: 11, height: 11, rx: 2 }],
        ['path', { d: 'M5 15V6a2 2 0 0 1 2-2h9' }],
      ]),
      icon('i-check', [['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]]),
      label,
    );
    // Said aloud, because the button's own picture changing is not.
    const status = document.createElement('span');
    status.className = 'sr';
    status.setAttribute('role', 'status');
    // What is copied is what is typed, in a console (never its prompts or what came back), and all of it otherwise.
    const typed = () => [...figure.querySelectorAll('.line.cmd, .line.cont')];
    let timer;
    b.addEventListener('click', async () => {
      clearTimeout(timer);
      const text = typed().length
        ? typed()
            .map((l) => l.textContent)
            .join('\n')
        : (code.textContent ?? '');
      try {
        await navigator.clipboard.writeText(text);
        b.dataset.state = 'copied';
        status.textContent = 'Copied to the clipboard.';
      } catch {
        // No clipboard here (an address that is not secure, a browser that refuses): select it for the person to copy.
        getSelection()?.selectAllChildren(code);
        status.textContent = 'It could not be copied. It is selected: press Control and C.';
      }
      timer = setTimeout(() => {
        delete b.dataset.state;
        status.textContent = '';
      }, 1800);
    });
    (figure.querySelector('.code-bar') ?? figure).append(b, status);
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
