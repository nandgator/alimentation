import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

/** A surface: a hairline edge, the card colour, and no shadow of its own. */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn("card rounded-xl border border-border bg-card text-foreground", className)}
      {...props}
    />
  );
}
