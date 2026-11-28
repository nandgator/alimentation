import type { ReactNode } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * One figure of a row of three (DAT-08): one size, the label above in plain sentence case, the figure large and
 * tabular, a caption under it that says what qualifies it ("Projected to month end"). With `href` the whole card
 * is the link, so "To confirm" and "Eating today" lead somewhere.
 */
export function StatCard({
  label,
  children,
  caption,
  href,
  className,
}: {
  label: string;
  /** The figure. */
  children: ReactNode;
  caption?: ReactNode;
  href?: string;
  className?: string;
}) {
  const body = (
    <Card
      className={cn(
        "h-full gap-1 px-4",
        href &&
          "transition-colors hover:bg-muted/50 group-focus-visible:ring-3 group-focus-visible:ring-ring/50",
        className,
      )}
    >
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="text-3xl font-[650] tabular-nums tracking-tight">{children}</p>
      {caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null}
    </Card>
  );
  return href ? (
    <Link href={href} className="group block rounded-xl outline-none">
      {body}
    </Link>
  ) : (
    body
  );
}

/** The heading of a card: a real H2, so the page has an outline. */
export function CardHeading({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-base font-semibold leading-snug">
      {children}
    </h2>
  );
}
