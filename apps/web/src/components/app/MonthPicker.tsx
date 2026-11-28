import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { monthLong } from "@/format";
import { useUrlState } from "@/hooks/use-url-state";

/** `YYYY-MM` shifted by `by` months. */
export function shiftMonth(m: string, by: number): string {
  const [y = 1970, n = 1] = m.split("-").map(Number);
  const t = y * 12 + (n - 1) + by;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/**
 * A month, as "November 2026" with a step either way (FRM-06). Controlled: pass `value` and `onChange` (`YYYY-MM`).
 * `min` and `max` bound the steps. To keep the month in the address bar, use `UrlMonthPicker`.
 */
export function MonthPicker({
  value,
  onChange,
  min,
  max,
  label = "Month",
}: {
  value: string;
  onChange: (month: string) => void;
  min?: string;
  max?: string;
  label?: string;
}) {
  const prev = shiftMonth(value, -1);
  const next = shiftMonth(value, 1);
  return (
    <div role="group" aria-label={label} className="inline-flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Previous month"
        disabled={!!min && prev < min}
        onClick={() => onChange(prev)}
      >
        <ChevronLeftIcon aria-hidden="true" />
      </Button>
      <output aria-live="polite" className="min-w-36 text-center text-sm font-medium tabular-nums">
        {monthLong(value)}
      </output>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Next month"
        disabled={!!max && next > max}
        onClick={() => onChange(next)}
      >
        <ChevronRightIcon aria-hidden="true" />
      </Button>
    </div>
  );
}

/** A MonthPicker whose value lives in the URL as `?month=2026-11` (NAV-16). `fallback` is the month when there is none. */
export function UrlMonthPicker({
  fallback,
  min,
  max,
  label,
}: {
  fallback: string;
  min?: string;
  max?: string;
  label?: string;
}) {
  const [month, setMonth] = useUrlState("month", fallback);
  return <MonthPicker value={month} onChange={setMonth} min={min} max={max} label={label} />;
}
