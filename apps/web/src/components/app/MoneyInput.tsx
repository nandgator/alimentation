import type { ComponentProps } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { rupeesText, toPaise } from "@/format";

/**
 * Rupees typed by a person (FRM-07): a ₹ prefix, a decimal keypad on phones, and on blur a clean value ("3,200"
 * becomes "3200", "12.5" becomes "12.50"). The value is the text; read it with `toPaise`, which returns null for
 * what is not an amount. Pass the `id` and `aria-*` props a Field gives, as for an Input.
 */
export function MoneyInput({
  value,
  onChange,
  onBlur,
  className,
  ...props
}: Omit<ComponentProps<typeof InputGroupInput>, "value" | "onChange" | "type" | "inputMode"> & {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <InputGroup className={className}>
      <InputGroupAddon>
        <InputGroupText aria-hidden="true">₹</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        className="tabular-nums"
        {...props}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          const p = toPaise(e.target.value);
          if (p !== null) {
            const text = rupeesText(p);
            if (text !== e.target.value) onChange(text);
          }
          onBlur?.(e);
        }}
      />
    </InputGroup>
  );
}

/** The value of a MoneyInput as paise, or null when it is empty or not an amount. */
export const moneyInputPaise = (value: string): number | null => toPaise(value);
