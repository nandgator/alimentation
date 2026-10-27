/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { check, checkCssText, checkTsxText } from '../../../scripts/check-design.mjs';

const rulesBroken = (css: string) => [...new Set(checkCssText(css).map((p) => p.rule))].sort();

describe('the application keeps to its design system', () => {
  it('has no departure from it anywhere', () => {
    expect(check().map((p) => `${p.file}:${p.line} [${p.rule}] ${p.why}`)).toEqual([]);
  });
});

describe('the design checker notices what it is for', () => {
  it('accepts a rule written in tokens', () => {
    expect(
      rulesBroken(`
        .a {
          color: var(--ink);
          background: color-mix(in srgb, var(--brand) 80%, white);
          border-radius: var(--radius-md);
          box-shadow: var(--elev-menu);
          z-index: var(--z-bar);
          font: 600 var(--text-sm)/1.2 var(--sans);
          font-size: var(--text-lg);
          padding: 8px 12px 24px;
          margin: 0 auto;
          transition: opacity var(--dur-2) var(--ease-out);
        }
        @media (max-width: 720px) { .a { gap: 96px; } }
      `),
    ).toEqual([]);
  });

  it('notices a colour that is not a token, in any notation', () => {
    for (const c of ['#123456', '#abc', 'rgb(1 2 3)', 'rgba(0, 0, 0, 0.5)', 'hsl(120 40% 40%)'])
      expect(rulesBroken(`.a { color: ${c}; }`), c).toEqual(['colour']);
    // A token may name a colour: that is where colours are made.
    expect(rulesBroken(`:root { --brand: #1f4d3a; }`)).toEqual([]);
  });

  it('notices a shadow that is not on the scale, and one pushed through a filter', () => {
    expect(rulesBroken('.a { box-shadow: 0 1px 2px black; }')).toEqual(['shadow']);
    expect(rulesBroken('.a { filter: drop-shadow(0 2px 3px black); }')).toEqual(['shadow']);
    expect(rulesBroken('.a { box-shadow: none; }')).toEqual([]);
  });

  it('notices a layer that is not on the scale, but allows a few inside a component', () => {
    expect(rulesBroken('.a { z-index: 999; }')).toEqual(['layer']);
    expect(rulesBroken('.a { z-index: 1; }')).toEqual([]);
    expect(rulesBroken('.a { z-index: calc(var(--z-drawer) - 1); }')).toEqual([]);
  });

  it('notices motion that does not use the shared durations and curves', () => {
    expect(rulesBroken('.a { transition: opacity 300ms var(--ease-out); }')).toEqual(['motion']);
    expect(rulesBroken('.a { animation: x 1s cubic-bezier(0, 0, 1, 1); }')).toEqual(['motion']);
    expect(rulesBroken('.a { transition: opacity var(--dur-1) ease; }')).toEqual([]);
    // Reduced motion is the one place that turns it down to nothing.
    expect(
      rulesBroken(
        '@media (prefers-reduced-motion: reduce) { .a { transition-duration: 0.001ms !important; } }',
      ),
    ).toEqual([]);
  });

  it('notices a font, a size, a radius and a space that are off their scales', () => {
    expect(rulesBroken('.a { font-family: Arial; }')).toEqual(['font']);
    expect(rulesBroken('.a { font-size: 13px; }')).toEqual(['type']);
    expect(rulesBroken('.a { font: 600 0.8rem/1.2 var(--sans); }')).toEqual(['type']);
    expect(rulesBroken('.a { border-radius: 7px; }')).toEqual(['radius']);
    expect(rulesBroken('.a { padding: 7px; }')).toEqual(['space']);
    expect(rulesBroken('.a { gap: 26px; }')).toEqual(['space']);
  });

  it('notices !important outside reduced motion, and a breakpoint that is not one of ours', () => {
    expect(rulesBroken('.a { color: var(--ink) !important; }')).toEqual(['important']);
    expect(rulesBroken('@media (max-width: 777px) { .a { gap: 4px; } }')).toEqual(['breakpoint']);
  });

  describe('a select draws its own arrow, and keeps room for it', () => {
    const shared = 'input, select, textarea { padding: 0.65rem 0.8rem; }';
    const arrow = `select { appearance: none; padding-right: 40px; background-image: linear-gradient(to top right, transparent, var(--ink-2)); }`;
    const why = (css: string) => checkCssText(css).map((p) => `${p.rule}: ${p.why}`);

    it('accepts the shared arrow, and a narrower select that leaves its room alone', () => {
      expect(
        why(`${shared}\n${arrow}\n.acting select { padding-block: 0.3rem; padding-left: 0.6rem; }`),
      ).toEqual([]);
      expect(why('.a { color: var(--ink); }')).toEqual([]);
    });

    it('accepts drawing the open list as well, where the browser allows it', () => {
      expect(
        why(
          `${shared}\n${arrow}\n@supports (appearance: base-select) { select, ::picker(select) { appearance: base-select; } select::picker-icon { display: none; } }`,
        ),
      ).toEqual([]);
      // But a select cannot be handed back to the browser's own drawing.
      expect(why(`${shared}\n${arrow}\nselect.fit { appearance: auto; }`).join('|')).toMatch(
        /appearance stays none/,
      );
    });

    it('notices the browser being left to draw the arrow, wherever it likes', () => {
      expect(why(`${shared}\nselect { min-height: 44px; }`).join('|')).toMatch(/appearance none/);
      expect(why(`${shared}\nselect { appearance: auto; padding-right: 40px; }`).join('|')).toMatch(
        /appearance none/,
      );
    });

    it('notices selects that are styled with no rule to draw their arrow', () => {
      expect(why(`${shared}\n.acting select { padding-block: 4px; }`).join('|')).toMatch(
        /no `select` rule that draws their arrow/,
      );
    });

    it('notices an arrow with no room: the mistake that put it against the edge', () => {
      expect(
        why(`${shared}\n${arrow}\n.acting select { padding: 0.3rem 0.6rem; }`).join('|'),
      ).toMatch(/leave 40px at the right/);
      expect(why(`${shared}\n${arrow}\nselect.fit { padding-right: 8px; }`).join('|')).toMatch(
        /leave 40px at the right/,
      );
      expect(
        why(
          `${shared}\nselect { appearance: none; padding-right: 12px; background-image: linear-gradient(red, blue); }`,
        ).join('|'),
      ).toMatch(/padding-right of 40px or more/);
    });

    it('notices the select rule coming before the shared one, which would then undo its room', () => {
      expect(why(`${arrow}\n${shared}`).join('|')).toMatch(/must come after the shared/);
    });
  });

  it('lets a line say why it is the exception, on that line only', () => {
    expect(
      rulesBroken('.a { color: #123456; /* design: a brand mark that must not change */ }'),
    ).toEqual([]);
    expect(rulesBroken('.a { color: #123456; }\n.b { color: #654321; /* design: why */ }')).toEqual(
      ['colour'],
    );
  });

  it('exempts the pictures of the home page from shape and space, and from nothing else', () => {
    const css = '.a { border-radius: 3px; padding: 7px; color: #123456; }';
    expect(
      checkCssText(css, 'home.css', 'colour shadow layer important font').map((p) => p.rule),
    ).toEqual(['colour']);
  });

  it('notices styling done inline, and allows handing a value to the stylesheet', () => {
    expect(checkTsxText(`<p style={{ marginTop: 16 }}>x</p>`).map((p) => p.rule)).toEqual([
      'inline',
    ]);
    expect(checkTsxText(`<p style={{ color: ok ? 'red' : 'blue' }}>x</p>`)).toHaveLength(1);
    expect(checkTsxText(`<i style={{ ['--pct' as string]: \`\${pct}%\` }} />`)).toEqual([]);
    expect(checkTsxText(`<div style={{ ['--gap' as string]: 'var(--space-2)' }}>x</div>`)).toEqual(
      [],
    );
    expect(
      checkTsxText(`// design: a place from the scroll\n<g style={{ transform: world }} />`),
    ).toEqual([]);
  });
});
