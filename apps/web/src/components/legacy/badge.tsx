import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";

export const badgeVariants = cva(
  "inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 font-medium text-xs leading-snug",
  {
    defaultVariants: { tone: "neutral" },
    variants: {
      tone: {
        neutral: "bg-muted text-muted-foreground",
        good: "bg-[var(--good-soft)] text-[var(--good)]",
        warn: "bg-[var(--warn-soft)] text-[var(--warn)]",
        bad: "bg-[var(--bad-soft)] text-[var(--bad)]",
      },
    },
  },
);

export interface BadgeProps extends ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

/** A short status. The `chip` class stays on it, because the guides and tests name it. */
export function Badge({ className, tone, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn("chip", tone ?? "", badgeVariants({ tone }), className)}
      {...props}
    />
  );
}
