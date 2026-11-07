/// <reference types="node" />
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_POLICY, FREE_LIMITS } from "@alimentation/core";
import { describe, expect, it } from "vitest";
import { buildDocs } from "../scripts/build-docs.mjs";

const REPO_SITE = join(import.meta.dirname, "..", "..", "..", "docs", "site");
const read = (file: string) => readFileSync(join(REPO_SITE, file), "utf8");
const listed = (dir: string) =>
  (JSON.parse(read(`${dir}/nav.json`)) as { sections: { pages: string[] }[] }).sections.flatMap(
    (s) => s.pages,
  );

/** A built web app, as far as the documentation needs one: an index page that names the stylesheet. */
function fakeDist(): string {
  const dist = mkdtempSync(join(tmpdir(), "alim-dist-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(
    join(dist, "index.html"),
    '<!doctype html><html><head><link rel="stylesheet" href="/assets/index-test.css"></head></html>',
  );
  return dist;
}

const page = (title: string, body: string) =>
  `---\ntitle: ${title}\ndescription: About ${title}.\n---\n\n# ${title}\n\n${body}\n`;
const nav = (...slugs: string[]) => ({ title: "t", sections: [{ title: "All", pages: slugs }] });

/** The Markdown files of a source, as navigation lists them. */
const pagesOf = (files: Record<string, string>) =>
  Object.keys(files)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));

/** A small documentation source with both sites, for the checks that need something wrong in it. */
function smallSite(
  guides: Record<string, string>,
  docs: Record<string, string>,
  navs: { guides?: object; docs?: object } = {},
): string {
  const src = mkdtempSync(join(tmpdir(), "alim-site-"));
  const put = (dir: string, pages: Record<string, string>, n: object) => {
    mkdirSync(join(src, dir), { recursive: true });
    writeFileSync(join(src, dir, "nav.json"), JSON.stringify(n));
    for (const [file, text] of Object.entries(pages)) {
      mkdirSync(join(src, dir, file, ".."), { recursive: true });
      writeFileSync(join(src, dir, file), text);
    }
  };
  put("guides", guides, navs.guides ?? nav(...pagesOf(guides)));
  put("docs", docs, navs.docs ?? nav(...pagesOf(docs)));
  return src;
}
const ok = { "index.md": page("Home", "a") };

describe("the documentation sites", () => {
  const dist = fakeDist();
  const built = buildDocs({ dist });
  const html = (url: string) => readFileSync(join(dist, url, "index.html"), "utf8");
  const site = (dir: string) => built.sites.find((s) => s.dir === dir)!;

  it("builds two sites, the guides for people and the docs for technicians, each from its own navigation", () => {
    expect(built.sites.map((s) => s.dir)).toEqual(["guides", "docs"]);
    for (const dir of ["guides", "docs"]) {
      expect(site(dir).pages, dir).toHaveLength(listed(dir).length);
      expect(site(dir).pages[0]).toBe(`/${dir}/`);
    }
    expect(built.pages).toHaveLength(listed("guides").length + listed("docs").length);
  });

  it("gives every page one title, one heading and the app’s own stylesheet", () => {
    for (const url of built.pages) {
      const h = html(url);
      expect(h.match(/<h1[ >]/g), url).toHaveLength(1);
      expect(h).toContain('<link rel="stylesheet" href="/assets/index-test.css">');
      expect(h).toMatch(/<title>[^<]+<\/title>/);
      expect(h).toMatch(/<meta name="description" content="[^"]+">/);
    }
  });

  it("is built for a strict content-security policy: no inline script, no inline style, nothing from elsewhere", () => {
    for (const url of built.pages) {
      const h = html(url);
      expect(h, url).not.toMatch(/<script(?![^>]*\ssrc=)/);
      expect(h, url).not.toMatch(/<[a-z][^>]*\sstyle=/i);
      expect(h, url).not.toMatch(/<[a-z][^>]*\son[a-z]+=/i);
      expect(h, url).not.toMatch(/(?:src|href)="https?:\/\/(?!github\.com)/);
    }
  });

  it("marks the current page, and the site it is in, and links to the other site", () => {
    for (const url of built.pages) {
      const h = html(url);
      // A front page has no menu beside it, so there is no current entry to mark.
      expect(h.match(/aria-current="page"/g) ?? [], url).toHaveLength(
        url === "/guides/" || url === "/docs/" ? 0 : 1,
      );
      const dir = url.split("/")[1]!;
      const switcher = /<nav class="docs-switch"[^>]*>(.*?)<\/nav>/.exec(h)![1]!;
      expect(switcher, url).toContain(`<a href="/${dir}/" aria-current="true">`);
      expect(switcher.match(/aria-current/g), url).toHaveLength(1);
      expect(switcher, url).toContain('href="/guides/"');
      expect(switcher, url).toContain('href="/docs/"');
      const ids = [...h.matchAll(/<h[1-6] id="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size, url).toBe(ids.length);
    }
  });

  it("shows the contents as a heading for each part, with only the part being read open", () => {
    for (const url of built.pages) {
      if (url === "/guides/" || url === "/docs/") continue;
      const h = html(url);
      const dir = url.split("/")[1]!;
      const groups = h.match(/<details class="docs-group"[^>]*>/g) ?? [];
      const parts = (JSON.parse(read(`${dir}/nav.json`)) as { sections: unknown[] }).sections;
      expect(groups, url).toHaveLength(parts.length);
      expect(
        groups.filter((g) => g.includes(" open")),
        url,
      ).toHaveLength(1);
      // The open one is the one that holds the page being read.
      const open = /<details class="docs-group" open>(.*?)<\/details>/.exec(h)![1]!;
      expect(open, url).toContain('aria-current="page"');
      expect(h, url).toContain('<summary class="docs-group-title">');
    }
  });

  it("draws the badge in the page, so that it can be packed as the page is read", () => {
    for (const url of built.pages) {
      const h = html(url);
      expect(h, url).toContain('class="docs-mark"');
      expect(h.match(/class="mark-fill mark-fill-\d"/g), url).toHaveLength(4);
      expect(h, url).not.toContain('<img src="/favicon.svg"');
    }
  });

  it("lets a long path in code break after its slashes, and still shows what is in angle brackets", () => {
    const h = html("/docs/lifecycle/bundle-and-move/");
    expect(h).toContain("<code>GET /<wbr>api/<wbr>w/<wbr>:slug/<wbr>export</code>");
    expect(h).toContain("&lt;slug&gt;.alimentation.json");
    expect(h).not.toMatch(/<slug>/);
    // A short piece of code is left whole.
    expect(h).toContain("<code>BundleSchema</code>");
  });

  it("writes a search index for each site with one entry per page of that site only", () => {
    for (const dir of ["guides", "docs"]) {
      const index = JSON.parse(readFileSync(join(dist, dir, "search-index.json"), "utf8")) as {
        t: string;
        u: string;
        x: string;
      }[];
      expect(index.map((e) => e.u).sort(), dir).toEqual([...site(dir).pages].sort());
      expect(index.every((e) => e.t && e.x.length > 100)).toBe(true);
      expect(html(`/${dir}/`)).toContain(`data-index="/${dir}/search-index.json"`);
    }
  });

  it("shares one stylesheet and its scripts between the sites", () => {
    expect(readdirSync(join(dist, "doc-assets")).sort()).toEqual([
      "docs.css",
      "docs.js",
      "switch.js",
    ]);
    for (const url of built.pages) {
      const h = html(url);
      expect(h).toContain('href="/doc-assets/docs.css"');
      expect(h).toContain('src="/doc-assets/docs.js"');
      // The theme script is the app's own, so a choice made anywhere applies everywhere.
      expect(h).toContain('src="/theme.js"');
    }
  });

  it("turns a note, a tip and a warning into callouts and a table into a region that can be scrolled", () => {
    expect(html("/docs/concepts/trust-model/")).toContain(
      'class="tablewrap" tabindex="0" role="region"',
    );
    expect(html("/guides/start/roles/")).toContain("callout callout-warning");
    expect(html("/guides/start/overview/")).toContain("callout callout-note");
    expect(html("/guides/start/quickstart/")).toContain("callout callout-tip");
    expect(html("/docs/self-hosting/going-live/")).toContain('class="tick"');
  });

  it("opens each site on a front page: a hero and a few cards, with no menu or contents beside them", () => {
    for (const dir of ["guides", "docs"]) {
      const h = html(`/${dir}/`);
      expect(h).toContain('class="docs-home"');
      expect(h).not.toContain('class="docs-shell"');
      expect(h).not.toContain('class="docs-nav"');
      expect(h).not.toContain('class="docs-menu"');
      expect(h).not.toContain('class="docs-toc"');
      expect(h.match(/<section class="home-hero">/g), dir).toHaveLength(1);
      expect(h.match(/class="btn( ghost)?" href="\/[^"]+"/g)?.length, dir).toBeGreaterThanOrEqual(
        1,
      );
      expect(
        h.match(/<a class="feature" href="\/[^"]+"><h2>/g)?.length,
        dir,
      ).toBeGreaterThanOrEqual(3);
      // The pages every other page links to are not lost: the old front page's reading moved to a page.
      expect(h.match(/<a class="feature"/g)!.length, dir).toBeLessThanOrEqual(6);
    }
    // Both sites use the app's own theme script, so one theme choice applies to every page.
    for (const url of built.pages) expect(html(url), url).toContain('<script src="/theme.js">');
  });

  it("keeps each audience in its own place: no jargon in the guides, and a way across to the docs", () => {
    const jargon =
      /\b(postgres(ql)?|sql|api|docker|npm|oidc|cli|tls|checksum|endpoint|environment variables?|row-level)\b/i;
    for (const url of site("guides").pages) {
      const text = html(url).replace(/<(pre|code|nav|header|footer)[\s\S]*?<\/\1>/g, " ");
      expect(text.replace(/<[^>]+>/g, " "), url).not.toMatch(jargon);
    }
    expect(html("/guides/fair/your-data/")).toContain('href="/docs/lifecycle/bundle-and-move/"');
    expect(html("/guides/")).toContain('href="/docs/"');
    expect(html("/docs/")).toContain('href="/guides/"');
  });
});

describe("the documentation build refuses what would let a reader down", () => {
  const dist = fakeDist();
  const build = (
    guides: Record<string, string>,
    docs: Record<string, string> = ok,
    navs: { guides?: object; docs?: object } = {},
  ) => buildDocs({ src: smallSite(guides, docs, navs), dist });

  it("builds a small pair of sites, and lets a page in one link to the other", () => {
    const r = build(
      { "index.md": page("Home", "See [the technical side](/docs/other/#part).") },
      { "index.md": page("Home", "a"), "other.md": page("Other", "## Part\n\nx") },
    );
    expect(r.sites.map((s) => s.pages)).toEqual([["/guides/"], ["/docs/", "/docs/other/"]]);
  });

  it("fails on a link to a page that is not there, and on a section that is not there", () => {
    expect(() => build({ "index.md": page("Home", "[x](/guides/gone/)") })).toThrow(
      /\/guides\/gone\/ is not a page/,
    );
    expect(() => build({ "index.md": page("Home", "[x](/docs/gone/)") })).toThrow(
      /\/docs\/gone\/ is not a page/,
    );
    expect(() =>
      build(
        { "index.md": page("Home", "[x](/guides/other/#nope)"), "other.md": page("Other", "y") },
        ok,
        { guides: nav("index", "other") },
      ),
    ).toThrow(/no such section/);
    expect(() => build({ "index.md": page("Home", "[x](#nope)") })).toThrow(/no section "#nope"/);
  });

  it("fails on a page nobody can reach, a page listed twice, and a page that is missing", () => {
    expect(() =>
      build({ "index.md": page("Home", "a"), "lost.md": page("Lost", "b") }, ok, {
        guides: nav("index"),
      }),
    ).toThrow(/guides\/lost\.md is not in guides\/nav\.json/);
    expect(() => build(ok, ok, { docs: nav("index", "index") })).toThrow(
      /docs\/nav\.json lists index twice/,
    );
    expect(() => build(ok, ok, { guides: nav("index", "ghost") })).toThrow(
      /guides\/ghost\.md, which does not exist/,
    );
  });

  it("fails on a page with no title, two pages with one title, or no heading", () => {
    expect(() => build({ "index.md": "# Home\n\nx\n" })).toThrow(/front matter/);
    expect(() =>
      build({ "index.md": page("Same", "a"), "b.md": page("Same", "b") }, ok, {
        guides: nav("index", "b"),
      }),
    ).toThrow(/two pages in guides are called "Same"/);
    expect(() =>
      build({ "index.md": "---\ntitle: T\ndescription: D\n---\n\njust text\n" }),
    ).toThrow(/starts with one # heading/);
  });

  describe("a front page", () => {
    const home = (extra = "") =>
      `---\ntitle: Home\ndescription: About.\nlayout: home\n---\n${extra}`;
    const content = (n = 3) =>
      JSON.stringify({
        hero: {
          name: "Name",
          text: "Text",
          tagline: "A tagline.",
          actions: [{ text: "Go", link: "/guides/", kind: "brand" }],
        },
        features: Array.from({ length: n }, (_, i) => ({
          title: `Card ${i}`,
          details: "Details.",
          link: "/guides/",
        })),
      });
    const files = (md: string, json?: string) => ({
      "index.md": md,
      ...(json ? { "home.json": json } : {}),
    });

    it("builds from its home.json and takes its one heading from the hero", () => {
      const r = build(files(home(), content()));
      expect(r.sites[0]!.pages).toEqual(["/guides/"]);
    });

    it("refuses a home page with nothing to show, too few cards, or a bad action", () => {
      expect(() => build(files(home()))).toThrow(/home\.json is needed/);
      expect(() => build(files(home(), content(2)))).toThrow(/three to six feature cards/);
      expect(() => build(files(home(), content(7)))).toThrow(/three to six feature cards/);
      const bad = JSON.parse(content()) as { hero: { actions: { kind: string }[] } };
      bad.hero.actions[0]!.kind = "loud";
      expect(() => build(files(home(), JSON.stringify(bad)))).toThrow(/kind of "brand" or "alt"/);
    });

    it("refuses a second heading, an unknown layout, and a home page that is not the index", () => {
      expect(() => build(files(home("\n# Another heading\n"), content()))).toThrow(
        /takes its one heading from the hero/,
      );
      expect(() =>
        build(files("---\ntitle: T\ndescription: D\nlayout: wide\n---\n\n# T\n")),
      ).toThrow(/layout is "doc" or "home"/);
      expect(() =>
        build(
          {
            "index.md": page("Home", "a"),
            "other.md": `---\ntitle: O\ndescription: D\nlayout: home\n---\n`,
          },
          ok,
        ),
      ).toThrow(/only a site's index page can be a home page/);
    });

    it("checks the links in its cards like any other link", () => {
      const broken = JSON.parse(content()) as { features: { link: string }[] };
      broken.features[0]!.link = "/guides/gone/";
      expect(() => build(files(home(), JSON.stringify(broken)))).toThrow(
        /\/guides\/gone\/ is not a page/,
      );
    });
  });

  it("needs the web app built first", () => {
    const empty = mkdtempSync(join(tmpdir(), "alim-empty-"));
    expect(() => buildDocs({ src: smallSite(ok, ok), dist: empty })).toThrow(
      /run the web build first/,
    );
  });
});

describe("code and diagrams in the pages", () => {
  const dist = fakeDist();
  const build = (body: string) => {
    const src = smallSite({ "index.md": page("Home", body) }, ok);
    buildDocs({ src, dist });
    return {
      html: readFileSync(join(dist, "guides", "index.html"), "utf8"),
      css: readFileSync(join(dist, "doc-assets", "docs.css"), "utf8"),
    };
  };
  const fence = (info: string, body = "") => `\`\`\`${info}\n${body}\n\`\`\``;
  const ten = Array.from({ length: 10 }, (_, i) => `const n${i} = ${i};`).join("\n");
  const engine = readFileSync(
    join(import.meta.dirname, "..", "..", "..", "packages", "core", "src", "engine.ts"),
    "utf8",
  ).split("\n");

  it("highlights with class names, and the colours are the stylesheet's", () => {
    const { html } = build(fence("ts", 'const a: string = "x"; // note'));
    expect(html).toContain('<span class="hljs-keyword">const</span>');
    expect(html).toContain("hljs-string");
    expect(html).toContain("hljs-comment");
    expect(html).toContain('class="language-typescript hljs"');
    expect(html).toContain('<span class="code-name">TypeScript</span>');
  });

  it("numbers a listing from its length, and leaves commands and plain text alone unless asked", () => {
    expect(build(fence("ts", ten)).html).toContain('class="code numbered has-bar"');
    expect(build(fence("ts", "const a = 1;")).html).not.toContain("data-n=");
    expect(build(fence("sh", Array(8).fill("bun run test").join("\n"))).html).not.toContain(
      "data-n=",
    );
    expect(build(fence("text", Array(8).fill("x").join("\n"))).html).not.toContain("data-n=");
    expect(build(fence("ts numbers", "const a = 1;")).html).toContain('data-n="1"');
    expect(build(fence("ts nonumbers", ten)).html).not.toContain("data-n=");
  });

  it("puts the numbers in the margin: attributes drawn by the stylesheet, not text that is copied", () => {
    const { html } = build(fence("ts numbers", "const a = 1;"));
    const css = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");
    expect(html).not.toMatch(/<span class="line"[^>]*>\s*1\s/);
    expect(css).toMatch(
      /\.code\.numbered \.line::before\s*\{[^}]*content: attr\(data-n\)[^}]*user-select: none/s,
    );
  });

  it("keeps every line on its own: a token that runs over a break is closed and opened again", () => {
    const { html } = build(fence("ts", "/* one\n   two\n   three */\nconst a = 1;"));
    const lines = [
      ...html.matchAll(/<span class="line"[^>]*>(.*?)<\/span>(?=\n<span class="line"|<\/code>)/gs),
    ].map((m) => m[1]!);
    expect(lines).toHaveLength(4);
    for (const line of lines)
      expect(line.match(/<span/g)?.length, line).toBe(line.match(/<\/span>/g)?.length);
    expect(lines[1]).toContain("hljs-comment");
  });

  it("marks lines, and says which of the lines are wrong when they are not lines", () => {
    expect(build(fence("ts hl=2,4-5", ten)).html.match(/class="line hl"/g)).toHaveLength(3);
    expect(() => build(fence("ts hl=two", ten))).toThrow(/"two" is not a line/);
  });

  it("shows lines of a real file, as they are in it and numbered as in it", () => {
    const { html } = build(fence("ts file=packages/core/src/engine.ts#L29-L40"));
    expect(html).toContain('<span class="code-name">packages/core/src/engine.ts</span>');
    expect(html).toContain('<span class="code-range">lines 29\u201340</span>');
    expect(html).toContain('data-n="29"');
    // The page names a line range, so a reformat that moves the code must fail here, not in a browser.
    expect(html).toMatch(/data-n="29">.*export.*interface.*EngineData/s);
    expect(html).toContain('data-n="40"');
    expect(html).not.toContain('data-n="41"');
    const shown = [
      ...html.matchAll(
        /<span class="line" data-n="(\d+)">(.*?)<\/span>(?=\n<span class="line"|<\/code>)/gs,
      ),
    ];
    expect(shown).toHaveLength(12);
    for (const [, n, markup] of shown) {
      const text = markup!
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&");
      expect(text, `line ${n}`).toBe(engine[Number(n) - 1]);
    }
  });

  it("refuses a file that is not there, lines that are not in it, a path outside the repository, and a body as well as a file", () => {
    expect(() => build(fence("ts file=packages/core/src/nope.ts#L1-L2"))).toThrow(
      /nope\.ts does not exist/,
    );
    expect(() => build(fence("ts file=packages/core/src/engine.ts#L9000-L9001"))).toThrow(
      /lines 9000 to 9001 are not in it/,
    );
    expect(() => build(fence("ts file=packages/core/src/engine.ts#L5-L2"))).toThrow(
      /are not in it/,
    );
    expect(() => build(fence("ts file=../../etc/hostname"))).toThrow(/outside the repository/);
    expect(() => build(fence("ts file=packages/core/src/engine.ts"))).toThrow(
      /name the lines to show/,
    );
    expect(() => build(fence("ts file=packages/core/src/engine.ts#L1-L2", "const a = 1;"))).toThrow(
      /takes its lines from the file/,
    );
  });

  it("says which languages it can highlight when it is asked for another", () => {
    expect(() => build(fence("klingon", "qapla"))).toThrow(
      /no highlighting for "klingon".*typescript/,
    );
  });

  it("draws a diagram as an svg in the page, with its title, and its source for anyone who cannot see it", () => {
    const { html } = build(
      fence('mermaid title="Where a request goes"', "flowchart LR\n  A[Browser] --> B[Server]"),
    );
    expect(html).toContain('<figure class="diagram"');
    expect(html).toMatch(/<svg role="img" aria-labelledby="diagram-1"/);
    expect(html).toContain('<figcaption id="diagram-1">Where a request goes</figcaption>');
    expect(html).toContain("Browser");
    expect(html).toContain("The diagram as text");
    expect(html).toContain("A[Browser] --&gt; B[Server]");
  });

  it("lets nothing through that the content-security policy would refuse, or that would call another site", () => {
    const { html, css } = build(
      fence('mermaid title="T"', "flowchart TD\n  A[One] --> B[(Two)]\n  B --> C{Three}"),
    );
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/\sstyle\s*=/i);
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(css).not.toMatch(/@import|googleapis/);
    // What the diagram came with is in the site's stylesheet, scoped to diagrams and in the site's own font.
    expect(css).toMatch(/\.diagram svg \{[^}]*--_text:/s);
    expect(css).not.toMatch(/font-family: 'Inter'/);
  });

  it("colours a diagram from the design system, so it follows the theme without being drawn again", () => {
    const css = readFileSync(
      join(import.meta.dirname, "..", "scripts", "docs", "docs.css"),
      "utf8",
    );
    const roles = /\.diagram-scroll svg \{([^}]*)\}/.exec(css)![1]!;
    for (const role of ["--bg: var(--card)", "--fg: var(--ink)", "--accent: var(--brand)"])
      expect(roles).toContain(role);
    expect(roles).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("refuses a diagram with no title, and one that cannot be drawn, naming the page", () => {
    expect(() => build(fence("mermaid", "flowchart LR\n A --> B"))).toThrow(/needs a title/);
    expect(() => build(fence('mermaid title="Broken"', "this is not a diagram"))).toThrow(
      /guides\/index\.md: the diagram "Broken" cannot be drawn/,
    );
  });

  it("documents every colour the highlighting is drawn in", () => {
    const tokens = readFileSync(join(import.meta.dirname, "..", "src", "styles.css"), "utf8");
    const foundations = read("docs/design/foundations.md");
    const css = tokens;
    const names = [...tokens.matchAll(/^\s+(--code-[a-z]+):/gm)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThanOrEqual(6);
    for (const name of names) {
      expect(foundations, name).toContain(`<b>${name}</b>`);
      expect(css, name).toContain(`var(${name})`);
    }
  });

  it("shows a console as what is typed after a prompt and what came back, and the prompt is not text", () => {
    const { html } = build(
      fence(
        "console",
        '$ node cli.mjs keys:rewrap\n{"currentKey":2}\n$ docker run \\\n    --rm app\ndone',
      ),
    );
    expect(html).toContain('<figure class="code console has-bar">');
    expect(html).toContain('<span class="code-name">Console</span>');
    const kinds = [...html.matchAll(/<span class="line (cmd|cont|out)">/g)].map((m) => m[1]);
    expect(kinds).toEqual(["cmd", "out", "cmd", "cont", "out"]);
    // The prompt is the stylesheet's, so it is in no line's text.
    expect(html).not.toMatch(/<span class="line cmd">\s*\$/);
    expect(html).not.toContain("&#36;");
    expect(build(fence("console", '$ echo "hello"')).html).toContain("hljs-string");
    // What came back is shown as it came, not highlighted as a command.
    expect(html).toMatch(/<span class="line out">\{&quot;currentKey&quot;:2\}<\/span>/);
  });

  it("is told a console block has no command in it, and that an empty block is never meant", () => {
    expect(() => build(fence("console", "just words"))).toThrow(/start the line with "\$ "/);
    expect(() => build(fence("ts", ""))).toThrow(/nothing in it/);
    expect(() => build("```\n```")).toThrow(/nothing in it/);
  });

  it("does not take the word after a dash for a command: --rm is an option", () => {
    const { html } = build(fence("console", "$ docker compose run --rm app\n$ rm -rf build"));
    expect(html).toContain("--rm");
    expect(html).not.toContain('--<span class="hljs-built_in">rm</span>');
    expect(html).toContain('<span class="hljs-built_in">rm</span> -rf');
  });

  it("keeps a script a shell block, with no prompt", () => {
    const { html } = build(fence("sh", "set -eu\nnpm run build"));
    expect(html).toContain('<span class="code-name">Shell</span>');
    expect(html).not.toContain('class="line cmd"');
  });

  it("shows the source of a diagram as a code block too, with the same bar and copy button", () => {
    const { html } = build(fence('mermaid title="T"', "flowchart LR\n  A[One] --> B[Two]"));
    expect(html).toMatch(
      /<details class="diagram-source"><summary>The diagram as text<\/summary><figure class="code has-bar">/,
    );
    expect(html).toContain('<span class="code-name">Mermaid</span>');
  });

  it("has no listing in the real pages that is bare or empty, and the copy button script names the typed lines", () => {
    const real = fakeDist();
    buildDocs({ dist: real });
    let blocks = 0;
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.name === "index.html") {
          const html = readFileSync(file, "utf8");
          const pres = html.match(/<pre\b/g)?.length ?? 0;
          const inFigure =
            html.match(/<figure class="code[^"]*">(?:<figcaption.*?<\/figcaption>)?<pre\b/g)
              ?.length ?? 0;
          expect(inFigure, `${file}: a listing outside the code component`).toBe(pres);
          expect(html, `${file}: an empty listing`).not.toMatch(
            /<pre[^>]*><code[^>]*>(<span class="line">(<\/span>)?)?<\/code><\/pre>/,
          );
          blocks += pres;
        }
      }
    };
    walk(join(real, "docs"));
    walk(join(real, "guides"));
    expect(blocks).toBeGreaterThan(20);
    const script = readFileSync(join(real, "doc-assets", "docs.js"), "utf8");
    expect(script).toContain(".line.cmd, .line.cont");
  });

  it("has the diagram and the file excerpt in the pages that were written for them", () => {
    expect(read("docs/overview/architecture.md")).toMatch(/```mermaid title="[^"]+"/);
    expect(read("docs/concepts/billing-engine.md")).toContain(
      "file=packages/core/src/engine.ts#L29-L40",
    );
  });
});

describe("moving between the pages", () => {
  const dist = fakeDist();
  const built = buildDocs({ dist });
  const css = readFileSync(join(import.meta.dirname, "..", "scripts", "docs", "docs.css"), "utf8");
  const script = readFileSync(
    join(import.meta.dirname, "..", "scripts", "docs", "switch.js"),
    "utf8",
  );

  /** Runs switch.js as a page would, arriving at `now` from `from`, and says what it told the transition. */
  function arriving(from: string | null, now: string): string[] {
    const types = new Set<string>();
    let reveal: ((e: unknown) => void) | undefined;
    new Function("addEventListener", "navigation", "location", script)(
      (name: string, fn: (e: unknown) => void) => {
        if (name === "pagereveal") reveal = fn;
      },
      { activation: { from: from ? { url: `http://x${from}` } : null } },
      { pathname: now },
    );
    reveal!({ viewTransition: { types } });
    return [...types];
  }

  it("asks each page to move into the next, and to hold still when motion is reduced", () => {
    expect(css).toMatch(/@view-transition\s*\{\s*navigation: auto;/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*@view-transition\s*\{\s*navigation: none;/,
    );
    // The glide is only for those who have not asked for less motion, and the bar stays where it is.
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)\s*\{[^@]*active-view-transition-type\(to-docs\)/,
    );
    expect(css).toMatch(/\.docs-top\s*\{\s*view-transition-name: docs-top;/);
  });

  it("is told, by the page that opens, only of a move between the guides and the docs, and which way", () => {
    expect(arriving("/guides/how/bills/", "/docs/overview/map/")).toEqual(["to-docs"]);
    expect(arriving("/docs/overview/map/", "/guides/how/bills/")).toEqual(["to-guides"]);
    expect(arriving("/docs/", "/docs/api/reference/")).toEqual([]);
    expect(arriving("/guides/", "/guides/how/bills/")).toEqual([]);
    expect(arriving("/app", "/docs/")).toEqual([]);
    expect(arriving("/docs/", "/app")).toEqual([]);
    expect(arriving(null, "/docs/")).toEqual([]);
  });

  it("loads that script before the page is drawn, on every page", () => {
    for (const url of built.pages) {
      const h = readFileSync(join(dist, url, "index.html"), "utf8");
      expect(h, url).toMatch(/<script src="\/doc-assets\/switch\.js"><\/script>/);
    }
  });

  it("puts the menu at the right on a phone, and the name, the switch and the theme where a thumb is", () => {
    const phone = /@media \(max-width: 959px\)\s*\{([\s\S]*)$/.exec(css)![1]!;
    expect(phone).toMatch(
      /grid-template-areas:\s*["']brand menu["']\s*["']switch theme["']\s*["']search search["']/,
    );
    expect(phone).toMatch(/\.docs-menu\s*\{[^}]*grid-area: menu;[^}]*justify-self: end/);
  });

  it("links the API reference from the docs, and not from the guides, which are for people who use a kitchen", () => {
    const docs = readFileSync(join(dist, "docs", "index.html"), "utf8");
    const guides = readFileSync(join(dist, "guides", "index.html"), "utf8");
    expect(docs).toContain('<a href="/reference/">API reference</a>');
    expect(guides).not.toContain("/reference/");
  });
});

describe("documentation for language models", () => {
  const dist = fakeDist();
  const built = buildDocs({ dist });
  const short = readFileSync(join(dist, "llms.txt"), "utf8");
  const full = readFileSync(join(dist, "llms-full.txt"), "utf8");

  it("has a short map in the shape llms.txt asks for: a title, a summary, and links with a line each", () => {
    expect(short).toMatch(/^# Alimentation\n\n> /);
    expect(short).toMatch(/^## For an AI agent$/m);
    expect(short).toContain("[AI agents and MCP](/docs/api/agents/)");
    expect(short).toContain("(/llms-full.txt)");
  });

  it("lists every page of both sites once, with what it is about, and no front page", () => {
    const pages = built.pages.filter((u) => u !== "/guides/" && u !== "/docs/");
    expect(pages.length).toBeGreaterThan(40);
    for (const url of pages) {
      const lines = short.split("\n").filter((l) => l.includes(`](${url}):`));
      // The page about agents is also named at the top, where an agent looks first.
      expect(lines, url).toHaveLength(url === "/docs/api/agents/" ? 2 : 1);
      expect(lines[0], url).toMatch(/^- \[[^\]]+\]\(\/[^)]+\): \S/);
    }
    expect(short).not.toMatch(/\]\(\/(guides|docs)\/\):/);
  });

  it("has every page in full, with the lines of a code excerpt put in and none of the front matter", () => {
    for (const url of built.pages.filter((u) => u !== "/guides/" && u !== "/docs/"))
      expect(full, url).toContain(`Source: ${url}\n`);
    expect(full).not.toMatch(/^title: /m);
    expect(full).not.toMatch(/^description: /m);
    // The billing page shows lines of the engine by naming them; here they are.
    expect(full).toContain("// packages/core/src/engine.ts, lines 29 to 40");
    expect(full).toContain("export interface EngineData");
  });

  it("says nothing that is not in the pages: an agent is told what the guides tell a person", () => {
    expect(full).toContain("through the agent “Lunch bot”");
    expect(full).toContain("stays with a person");
  });
});

describe("what the documentation says is still what the app does", () => {
  it("states the free-tier numbers the app enforces", () => {
    const text = read("guides/fair/free-tier.md");
    const n = (v: number) => v.toLocaleString("en-US");
    const row = (label: string, value: string) =>
      new RegExp(`\\|\\s*\\*\\*${label}\\*\\*\\s*\\|\\s*${value}`);
    expect(text).toMatch(row("People", n(FREE_LIMITS.people)));
    expect(text).toMatch(row("Entries", n(FREE_LIMITS.rows)));
    expect(text).toMatch(row("Actions a day", `${n(FREE_LIMITS.requestsPerDay)},`));
    expect(text).toMatch(row("Storage", `${FREE_LIMITS.bytes / 1024 / 1024} MB`));
  });

  it("states the defaults a new kitchen starts with", () => {
    const rules = read("guides/admin/kitchen-rules.md");
    expect(DEFAULT_POLICY.workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(rules).toMatch(/Working days\*\*\s+\|[^|]+\|\s*Monday to Friday/);
    expect(DEFAULT_POLICY.holidays.count).toBe("confirmed");
    expect(rules).toMatch(/Holidays that cancel a meal\*\*\s+\|[^|]+\|\s*Only confirmed/);
    expect(DEFAULT_POLICY.leave.chargeBps).toBe(0);
    expect(rules).toMatch(/Charge on a leave day\*\*\s+\|[^|]+\|\s*0 percent/);
    expect(DEFAULT_POLICY.extras).toEqual({ minMeals: 1 });
    expect(DEFAULT_POLICY.payments).toBe("claim_confirm");
    expect(DEFAULT_POLICY.monthClose).toEqual({ mode: "manual", afterClose: "flag" });
    expect(rules).toMatch(/Month close\*\*\s+\|[^|]+\|\s*Closed by the admin/);
    expect(rules).toMatch(/Entries after close\*\*\s+\|[^|]+\|\s*Allowed, and flagged/);
    expect(DEFAULT_POLICY.rateCards.backdating).toBe("current_month");
    expect(rules).toMatch(/Rate cards may start\*\*\s+\|[^|]+\|\s*From the start of this month/);
    expect(DEFAULT_POLICY.exceptionCutoff).toBeNull();
    expect(rules).toMatch(/Exceptions due\*\*\s+\|[^|]+\|\s*None\s/);
  });

  it("works the month in the billing page out to the figure it prints", () => {
    // 14 veg at 120, 9 non-veg at 150, 30 of extras; a Friday leave, a Tuesday switched, two chapatis.
    const base = 14 * 120 + 9 * 150 + 30;
    expect(base).toBe(3060);
    expect(base - 150 + 30 + 20).toBe(2960);
    const text = read("guides/how/bills.md");
    expect(text).toContain("₹3,060");
    expect(text).toContain("₹2,960");
  });

  it("lists every setting the server reads, in the configuration page", () => {
    const config = readFileSync(
      join(import.meta.dirname, "..", "..", "api", "src", "config.ts"),
      "utf8",
    );
    const schema = /const Env = z\.object\(\{([\s\S]*?)\n\}\);/.exec(config)![1]!;
    const names = [...schema.matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(10);
    const page = read("docs/self-hosting/configuration.md");
    for (const name of names) expect(page, name).toContain(`\`${name}\``);
  });

  it("names every command the command line offers", () => {
    const cli = readFileSync(join(import.meta.dirname, "..", "..", "api", "src", "cli.ts"), "utf8");
    const commands = [...cli.matchAll(/case ["']([a-z]+:?[a-z]*)["']:/g)].map((m) => m[1]!);
    expect(commands.length).toBeGreaterThanOrEqual(6);
    const page = read("docs/self-hosting/cli.md");
    for (const c of commands) expect(page, c).toContain(`\`${c}\``);
  });
});
