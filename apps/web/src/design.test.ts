/// <reference types="node" />
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  check,
  checkCssText,
  checkPageText,
  checkSpecText,
  checkTsxText,
} from "../../../scripts/check-design.mjs";

const rules = (problems: { rule: string }[]) => [...new Set(problems.map((p) => p.rule))].sort();
const tsx = (code: string, file = "src/pages/A.tsx") => rules(checkTsxText(code, file));
const css = (code: string, set = "all") => rules(checkCssText(code, "a.css", set));

describe("the application keeps to its design system", () => {
  it("has no departure from it anywhere", () => {
    expect(check().map((p) => `${p.file}:${p.line} [${p.rule}] ${p.why}`)).toEqual([]);
  });

  it("has left the old stylesheets, the old controls and the token bridge behind", () => {
    const src = join(import.meta.dirname);
    for (const gone of ["styles.css", "home.css", "components/ui.tsx", "components/legacy"])
      expect(existsSync(join(src, gone)), gone).toBe(false);
  });
});

describe("the checker notices what it is for", () => {
  it("accepts a screen written in tokens", () => {
    expect(
      tsx(
        `<div className="flex gap-4 rounded-xl border bg-card p-4 text-sm text-muted-foreground shadow-md">
           <Button variant="outline">Save</Button>
         </div>`,
      ),
    ).toEqual([]);
  });

  describe("colour", () => {
    it("notices a raw colour in a class, in a string and in a stylesheet, in any notation", () => {
      for (const c of [
        "#123456",
        "#abc",
        "rgb(1 2 3)",
        "rgba(0, 0, 0, 0.5)",
        "hsl(120 40% 40%)",
        "oklch(0.5 0.1 200)",
      ]) {
        expect(tsx(`<p className="bg-[${c}]">x</p>`), c).toContain("colour");
        expect(tsx(`const c = "${c}";`), c).toContain("colour");
        expect(css(`.a { color: ${c}; }`), c).toEqual(["colour"]);
      }
    });
    it("lets a colour be mixed from tokens, and a link keep its anchor", () => {
      expect(
        css(".a { background: color-mix(in oklch, var(--primary) 20%, transparent); }"),
      ).toEqual([]);
      expect(tsx(`<a href="#main">Skip</a>`)).toEqual([]);
      expect(tsx(`<p className="bg-primary/10 text-primary">x</p>`)).toEqual([]);
    });
  });

  describe("shadow and radius", () => {
    it("notices a shadow or a radius that is not a token", () => {
      expect(css(".a { box-shadow: 0 1px 2px var(--x); }")).toEqual(["shadow"]);
      expect(css(".a { filter: drop-shadow(0 2px 3px black); }")).toEqual(["shadow"]);
      expect(css(".a { border-radius: 7px; }")).toEqual(["radius"]);
      expect(tsx(`<p className="shadow-[0_1px_3px_black]">x</p>`)).toEqual(["shadow"]);
      expect(tsx(`<p className="rounded-[7px]">x</p>`)).toEqual(["radius"]);
    });
    it("accepts none, a token, a pill and a circle", () => {
      expect(css(".a { box-shadow: none; border-radius: var(--radius); }")).toEqual([]);
      expect(css(".a { box-shadow: var(--lift); border-radius: 50%; }")).toEqual([]);
      expect(css(".a { filter: drop-shadow(var(--x)); border-radius: 999px; }")).toEqual([]);
      expect(tsx(`<p className="rounded-lg shadow-md">x</p>`)).toEqual([]);
    });
  });

  describe("arbitrary values", () => {
    it("notices an arbitrary length, except in the shadcn components", () => {
      expect(tsx(`<p className="w-[13px]">x</p>`)).toEqual(["arbitrary"]);
      expect(tsx(`<p className="md:min-h-[2.5rem] -mt-[3px]">x</p>`)).toEqual(["arbitrary"]);
      expect(tsx(`<p className="w-[13px]">x</p>`, "src/components/ui/card.tsx")).toEqual([]);
    });
    it("accepts a value that is not a length, or is a token", () => {
      expect(
        tsx(
          `<p className="grid-cols-[1fr_auto] w-[var(--sidebar-width)] font-[650] [&_svg]:size-4">x</p>`,
        ),
      ).toEqual([]);
    });
  });

  describe("native controls", () => {
    it("notices a native number, date, checkbox, radio or file input, and a select", () => {
      for (const t of ["number", "date", "checkbox", "radio", "file"])
        expect(tsx(`<input type="${t}" />`), t).toEqual(["control"]);
      expect(tsx(`<select><option>a</option></select>`)).toEqual(["control"]);
    });
    it("lets the kit itself use them, and a text field alone", () => {
      expect(tsx(`<input type="number" />`, "src/components/app/CountInput.tsx")).toEqual([]);
      expect(tsx(`<input type="date" />`, "src/components/ui/calendar.tsx")).toEqual([]);
      expect(tsx(`<input type="text" /><input type="email" />`)).toEqual([]);
    });
  });

  it("notices a page reload", () => {
    expect(tsx(`onClick={() => window.location.reload()}`)).toEqual(["reload"]);
    expect(tsx(`location.reload();`)).toEqual(["reload"]);
    expect(tsx(`const reload = () => load();`)).toEqual([]);
  });

  describe("icons", () => {
    it("notices another icon set, and an inline svg outside the places that draw", () => {
      expect(tsx(`import { FiX } from "react-icons/fi";`)).toEqual(["icon"]);
      expect(tsx(`<svg viewBox="0 0 1 1" />`)).toEqual(["icon"]);
    });
    it("accepts lucide, and the drawn pictures", () => {
      expect(tsx(`import { XIcon } from "lucide-react";`)).toEqual([]);
      expect(tsx(`<svg viewBox="0 0 1 1" />`, "src/components/Mark.tsx")).toEqual([]);
      expect(tsx(`<svg viewBox="0 0 1 1" />`, "src/home/art.tsx")).toEqual([]);
    });
  });

  describe("role names", () => {
    it("notices a role written out in the words a person reads", () => {
      expect(tsx(`<p>Ask your Supplier</p>`)).toEqual(["role"]);
      expect(tsx(`const t = "Members";`)).toEqual(["role"]);
      expect(tsx("toast(`Added a Member`)")).toEqual(["role"]);
    });
    it("leaves the label table, comments and code alone", () => {
      expect(tsx(`const ROLE_LABEL = { supplier: "Cook" };`)).toEqual([]);
      expect(tsx(`// a Supplier in the old words\nconst role = "supplier";`)).toEqual([]);
      expect(
        tsx(`export const ROLE_LABEL = { admin: "Member" };`, "src/pages/workspace/sections.ts"),
      ).toEqual([]);
    });
  });

  describe("inline styles", () => {
    it("notices a style that is not explained", () => {
      expect(tsx(`<p style={{ marginTop: 16 }}>x</p>`)).toEqual(["inline"]);
      expect(tsx(`<i style={{ ["--pct" as string]: pct }} />`)).toEqual(["inline"]);
    });
    it("accepts one that says why, on its line or the line above", () => {
      expect(tsx(`<i style={{ ["--pct" as string]: pct }} /> // design: the bar's width`)).toEqual(
        [],
      );
      expect(tsx(`// design: a place from the scroll\n<g style={{ transform: world }} />`)).toEqual(
        [],
      );
      expect(
        tsx(`{/* design: a place from the scroll */}\n<g style={{ transform: world }} />`),
      ).toEqual([]);
    });
    it("does not take a comment mark inside a string for a comment", () => {
      expect(tsx(`const u = "https://example.org"; const c = "#123456";`)).toEqual(["colour"]);
    });
    it("reads a waiver only as far as the next line", () => {
      expect(tsx(`// design: why\nconst a = 1;\n<p style={{ margin: 1 }} />`)).toEqual(["inline"]);
    });
  });

  it("notices a small filled dot standing for a status", () => {
    expect(tsx(`<span className="size-2 rounded-full bg-success" />`)).toEqual(["status"]);
    expect(tsx(`<span className="size-3 rounded-full bg-warning" />`)).toEqual(["status"]);
    expect(tsx(`<span className="size-8 rounded-full bg-muted" />`)).toEqual([]);
    expect(tsx(`<StatusBadge tone="success">Paid</StatusBadge>`)).toEqual([]);
  });

  describe("tests find things by what a person sees", () => {
    it("notices a selector by class", () => {
      expect(rules(checkSpecText(`page.locator(".card")`))).toEqual(["selector"]);
      expect(rules(checkSpecText(`page.locator("div.row > span")`))).toEqual(["selector"]);
      expect(rules(checkSpecText(`el.querySelector('[class*="tone"]')`))).toEqual(["selector"]);
    });
    it("accepts role, label, text, test ids and attributes", () => {
      expect(
        checkSpecText(
          `page.getByRole("button", { name: "Save" });\npage.locator("[data-sonner-toast]");\npage.locator("main h1");\npage.locator("a[href='/x.y']");`,
        ),
      ).toEqual([]);
    });
    it("lets a line say why", () => {
      expect(checkSpecText(`// design: why\nel.querySelector(".hljs")`)).toEqual([]);
    });
  });

  describe("every screen has a title", () => {
    it("notices a screen with no PageHeader or NotAvailable", () => {
      expect(rules(checkPageText(`export function P() { return <div>hello</div>; }`))).toEqual([
        "title",
      ]);
      expect(checkPageText(`return <PageHeader title="A" />;`)).toEqual([]);
      expect(checkPageText(`return <NotAvailable />;`)).toEqual([]);
    });
  });

  it("checks the stylesheets of the home page for colour and shadow only", () => {
    const sheet = ".a { border-radius: 3px; padding: 7px; color: #123456; }";
    expect(checkCssText(sheet, "art.css", "colour shadow").map((p) => p.rule)).toEqual(["colour"]);
  });
});
