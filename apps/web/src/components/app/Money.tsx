import { balance, money } from "@/format";
import { cn } from "@/lib/utils";

/**
 * An amount for display (DAT-04): ₹0 for zero, a true minus for a negative, tabular figures. `credit` reads the
 * amount as a balance where positive is credit held ("Credit ₹580"). `fraction` shows two places on every amount,
 * so a column of them lines up: set it on every cell of the column or none.
 */
export function Money({
  paise,
  credit = false,
  fraction = false,
  className,
}: {
  paise: number;
  credit?: boolean;
  fraction?: boolean;
  className?: string;
}) {
  const text = credit ? balance(paise, { fixed: fraction }) : money(paise, { fixed: fraction });
  return <span className={cn("tabular-nums", className)}>{text}</span>;
}
