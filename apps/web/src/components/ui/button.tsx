import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn.ts";

/**
 * A button, after coss/ui: a hairline border, a light edge along the top of a raised one, and a ring for focus.
 * It is 44 pixels high, as the system says every control is, and the small one 36.
 */
export const buttonVariants = cva(
  "relative inline-flex no-underline! shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium text-base outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: { size: "default", variant: "default" },
    variants: {
      size: {
        sm: "h-9 gap-1.5 px-3 text-sm",
        default: "h-11 px-4",
        lg: "h-12 px-5 text-lg",
        icon: "size-11",
      },
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground! shadow-xs inset-shadow-[0_1px_var(--lift-inner)] hover:bg-primary/90 active:shadow-none",
        accent:
          "border-transparent bg-[var(--accent)] text-[var(--accent-ink)]! shadow-xs inset-shadow-[0_1px_var(--lift-inner)] hover:bg-[var(--accent)]/90 active:shadow-none",
        destructive:
          "border-destructive bg-destructive text-[var(--bad-ink)]! shadow-xs inset-shadow-[0_1px_var(--lift-inner)] hover:bg-destructive/90 active:shadow-none",
        outline:
          "border-input bg-card text-foreground! shadow-xs hover:bg-accent active:shadow-none",
        secondary: "border-transparent bg-secondary text-foreground! hover:bg-secondary/80",
        ghost: "border-transparent text-foreground! hover:bg-accent",
        link: "border-transparent text-foreground! underline-offset-4 hover:underline!",
      },
    },
  },
);

export interface ButtonProps
  extends useRender.ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {}

const SLOT = { "data-slot": "button" } as object;

export function Button({ className, variant, size, render, ...props }: ButtonProps) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(buttonVariants({ variant, size }), className),
        type: render ? undefined : "button",
      },
      props,
      SLOT,
    ),
    render,
  });
}
