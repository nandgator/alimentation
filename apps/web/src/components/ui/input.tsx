import { Input as BaseInput } from "@base-ui/react/input";
import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

/** The control anatomy shared by the text controls: a hairline edge, ten pixels of radius, a ring for focus and a ring in red when invalid. */
export const controlClass =
  "w-full min-h-11 rounded-lg border border-input bg-card px-3 py-2.5 text-foreground shadow-xs outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive/60 aria-invalid:focus-visible:ring-destructive/30 disabled:opacity-60";

/** A text input. It keeps the `input` element, so a label, a name and a form work as they always did. */
export function Input({ className, ...props }: ComponentProps<typeof BaseInput>) {
  return (
    <BaseInput
      data-slot="input"
      className={cn(controlClass, typeof className === "string" ? className : undefined)}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(controlClass, "min-h-[84px] resize-y", className)}
      {...props}
    />
  );
}
