import type { ReactNode } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Mark } from "../components/Mark.tsx";
import { useSession } from "../session.tsx";

/** The two documentation sites, in the order every site header names them. */
export const DOC_SITES = [
  { href: "/guides/", name: "Guides" },
  { href: "/docs/", name: "Docs" },
] as const;

const link =
  "inline-flex min-h-11 items-center px-1 text-sm font-medium text-foreground underline decoration-transparent decoration-1 underline-offset-4 transition-[text-decoration-color] hover:decoration-current";

/**
 * The site header, the same on the home page, the guides and the docs (docs/research/ui-rewrite-plan.md, section 5):
 * the brand mark, Guides, Docs, and then "Open your kitchen" for someone signed in or "Sign in" for anyone else. The
 * guides and the docs draw their own copy at build time (scripts/build-docs.mjs); this is the page the app serves.
 * `chapters` is what only the home page adds: the sections of the page, in a bar of their own beside the name.
 */
export function SiteHeader({ chapters }: { chapters?: ReactNode }) {
  const { me } = useSession();
  const signedIn = !!me?.account;
  return (
    <header className="hnav sticky top-0 z-20 bg-background">
      <div className="hwrap flex min-h-16 items-center gap-3 sm:gap-6">
        <Link href="/" className="brand inline-flex min-h-11 items-center gap-2 font-semibold">
          <Mark packing /> <span className="max-sm:sr-only">Alimentation</span>
        </Link>
        {chapters}
        <nav aria-label="Documentation" className="ml-auto flex items-center gap-2 sm:gap-4">
          {DOC_SITES.map((s) => (
            <a key={s.href} href={s.href} className={link}>
              {s.name}
            </a>
          ))}
        </nav>
        <Button variant="outline" size="sm" render={<Link href={signedIn ? "/app" : "/signin"} />}>
          {signedIn ? "Open your kitchen" : "Sign in"}
        </Button>
      </div>
    </header>
  );
}
