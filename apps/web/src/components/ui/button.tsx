import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn.ts";

/**
 * A button, after coss/ui: a hairline border, a light edge along the top of a raised one, a ring for focus, and
 * on a touch screen a hit area of 44 pixels however small the button is drawn.
 */
export const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium text-base outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60 sm:text-sm pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: { size: "default", variant: "default" },
    variants: {
      size: {
        xs: "h-7 gap-1 rounded-md px-2 text-sm sm:h-6 sm:text-xs",
        sm: "h-8 gap-1.5 px-2.5 sm:h-7",
        default: "h-9 px-3 sm:h-8",
        lg: "h-10 px-3.5 sm:h-9",
        xl: "h-11 px-4 text-lg sm:h-10 sm:text-base",
        icon: "size-9 sm:size-8",
      },
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground shadow-xs inset-shadow-[0_1px_var(--lift-inner)] hover:bg-primary/90 active:shadow-none",
        destructive:
          "border-destructive bg-destructive text-[var(--bad-ink)] shadow-xs inset-shadow-[0_1px_var(--lift-inner)] hover:bg-destructive/90 active:shadow-none",
        outline:
          "border-input bg-card text-foreground shadow-xs hover:bg-accent active:shadow-none",
        secondary: "border-transparent bg-secondary text-foreground hover:bg-secondary/80",
        ghost: "border-transparent text-foreground hover:bg-accent",
        link: "border-transparent text-foreground underline-offset-4 hover:underline",
      },
    },
  },
);

export interface ButtonProps
  extends useRender.ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, render, ...props }: ButtonProps) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(buttonVariants({ variant, size }), className),
        type: render ? undefined : "button",
      },
      props,
    ),
    render,
  });
}
