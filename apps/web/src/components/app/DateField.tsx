import { CalendarIcon } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { date as showDate } from "@/format";
import { useIsNarrow } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

/** `YYYY-MM-DD` from a local Date, and back, with no time zone arithmetic. */
export const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const dateOf = (iso: string) => {
  const [y = 1970, m = 1, d = 1] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/**
 * A date (FRM-06): a button showing the date as dd-MMM-yyyy that opens a calendar, in a popover on desktop and a
 * bottom sheet on a phone. The value is `YYYY-MM-DD` or "". `min` and `max` bound it; `presets` adds the Today and
 * Yesterday chips. `today` is the kitchen's today when that differs from the device's.
 */
export function DateField({
  value,
  onChange,
  min,
  max,
  presets = true,
  today,
  placeholder = "Choose a date",
  label = "Choose a date",
  className,
  ...props
}: {
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  presets?: boolean;
  today?: string;
  placeholder?: string;
  /** Names the calendar for assistive technology. */
  label?: string;
} & Omit<ComponentProps<typeof Button>, "value" | "onChange" | "children">) {
  const [open, setOpen] = useState(false);
  const narrow = useIsNarrow();
  const now = today ?? isoOf(new Date());
  const yesterday = isoOf(new Date(dateOf(now).getTime() - 86_400_000 + 3_600_000));
  const inRange = (iso: string) => (!min || iso >= min) && (!max || iso <= max);
  const pick = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  const body = (
    <div className="flex flex-col gap-2">
      {presets ? (
        <div className="flex flex-wrap gap-2">
          {[
            { name: "Today", iso: now },
            { name: "Yesterday", iso: yesterday },
          ].map((p) => (
            <Button
              key={p.name}
              type="button"
              size="sm"
              variant={value === p.iso ? "default" : "outline"}
              disabled={!inRange(p.iso)}
              onClick={() => pick(p.iso)}
            >
              {p.name}
            </Button>
          ))}
        </div>
      ) : null}
      <Calendar
        mode="single"
        selected={value ? dateOf(value) : undefined}
        defaultMonth={value ? dateOf(value) : dateOf(now)}
        onSelect={(d) => d && pick(isoOf(d))}
        disabled={[
          ...(min ? [{ before: dateOf(min) }] : []),
          ...(max ? [{ after: dateOf(max) }] : []),
        ]}
        className="mx-auto p-0"
      />
    </div>
  );

  const trigger = (
    <Button
      type="button"
      variant="outline"
      className={cn(
        "w-full justify-start font-normal tabular-nums",
        !value && "text-muted-foreground",
        className,
      )}
      onClick={narrow ? () => setOpen(true) : undefined}
      {...props}
    >
      <CalendarIcon aria-hidden="true" />
      {value ? showDate(value) : placeholder}
    </Button>
  );

  if (narrow)
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="max-h-[90dvh] overflow-y-auto pb-[env(safe-area-inset-bottom)]"
          >
            <SheetHeader>
              <SheetTitle>{label}</SheetTitle>
              <SheetDescription className="sr-only">Pick a day from the calendar.</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-4">{body}</div>
          </SheetContent>
        </Sheet>
      </>
    );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" className="w-auto" aria-label={label}>
        {body}
      </PopoverContent>
    </Popover>
  );
}
