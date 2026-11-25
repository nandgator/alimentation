import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";
import { controlClass } from "./input.tsx";

/**
 * A select. It stays the browser's own element, so the keyboard, typing to find an option and the phone's
 * picker are unchanged, and the arrow and the open list are drawn by the sheet's rules for `select`.
 */
export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select data-slot="select" className={cn(controlClass, className)} {...props} />;
}
