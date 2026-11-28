import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";

/** A whole number typed by a person (FRM-07): a number keypad on phones, and never a spinner or the wheel that changes it. Digits only. */
export function CountInput({
  value,
  onChange,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type" | "inputMode"> & {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      className="tabular-nums"
      {...props}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D+/g, ""))}
    />
  );
}
