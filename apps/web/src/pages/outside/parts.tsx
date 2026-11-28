import { CircleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure, getJson } from "@/api";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export interface Loaded<T> {
  data: T | undefined;
  error: ApiFailure | null;
  /** The first read, with nothing yet to show. */
  loading: boolean;
  reload: () => void;
}

/** Reads one address and keeps the last answer on screen while it reads again or when a read fails. */
export function useLoad<T>(path: string | null): Loaded<T> {
  const [state, setState] = useState<{ data?: T; error: ApiFailure | null; busy: boolean }>({
    error: null,
    busy: path !== null,
  });
  const seq = useRef(0);
  const [tick, setTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` is the reload
  useEffect(() => {
    if (path === null) return;
    const mine = ++seq.current;
    setState((s) => ({ ...s, busy: true }));
    getJson<T>(path).then(
      (data) => mine === seq.current && setState({ data, error: null, busy: false }),
      (e) =>
        mine === seq.current &&
        setState((s) => ({
          ...s,
          error: e instanceof ApiFailure ? e : new ApiFailure(0, "error", String(e)),
          busy: false,
        })),
    );
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return {
    data: state.data,
    error: state.error,
    loading: state.busy && state.data === undefined,
    reload,
  };
}

/** A failed read: what the server said, and a way to try again. The data already on screen stays. */
export function LoadProblem({
  error,
  onRetry,
  title = "That could not be read",
}: {
  error: Error | null;
  onRetry?: () => void;
  title?: string;
}) {
  if (!error) return null;
  return (
    <Alert variant="destructive" role="alert">
      <CircleAlertIcon aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{error.message}</AlertDescription>
      {onRetry ? (
        <AlertAction>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}

/** A refusal from the server as words for a person. */
export const sayError = (e: unknown, fallback = "That did not work. Try again.") =>
  e instanceof Error && e.message ? e.message : fallback;

export interface ChoiceOption<V extends string> {
  value: V;
  label: string;
  hint?: string;
}

/** A few ticks that make a list of values: each is a checkbox beside its words, so a whole row is one target. */
export function CheckboxList<V extends string>({
  id,
  options,
  value,
  onChange,
  invalid,
  describedBy,
  label,
}: {
  id: string;
  options: ChoiceOption<V>[];
  value: V[];
  onChange: (next: V[]) => void;
  invalid?: boolean;
  describedBy?: string;
  /** Names the group for assistive technology. */
  label: string;
}) {
  return (
    <div
      id={id}
      role="group"
      aria-label={label}
      aria-describedby={describedBy}
      aria-invalid={invalid}
      className="flex flex-col gap-1"
    >
      {options.map((o) => (
        <Label
          key={o.value}
          className="flex min-h-11 items-start gap-3 rounded-lg px-1 py-2 font-normal pointer-fine:min-h-9"
        >
          <Checkbox
            className="mt-0.5"
            checked={value.includes(o.value)}
            onCheckedChange={(on) =>
              onChange(on ? [...value, o.value] : value.filter((v) => v !== o.value))
            }
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm">{o.label}</span>
            {o.hint ? <span className="text-sm text-muted-foreground">{o.hint}</span> : null}
          </span>
        </Label>
      ))}
    </div>
  );
}

export interface CardOption<V extends string> {
  value: V;
  title: string;
  description: string;
}

/** Radio buttons as cards: a bold title with its description under it, and the whole card is the target. */
export function RadioCards<V extends string>({
  id,
  label,
  options,
  value,
  onChange,
  onBlur,
  invalid,
  describedBy,
}: {
  id: string;
  /** Names the group for assistive technology. */
  label: string;
  options: readonly CardOption<V>[];
  value: V | "";
  onChange: (next: V) => void;
  onBlur?: () => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <RadioGroup
      id={id}
      aria-label={label}
      aria-describedby={describedBy}
      aria-invalid={invalid}
      value={value}
      onValueChange={(v) => onChange(v as V)}
      onBlur={onBlur}
    >
      {options.map((o) => (
        <FieldLabel key={o.value} htmlFor={`${id}-${o.value}`}>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>{o.title}</FieldTitle>
              <FieldDescription>{o.description}</FieldDescription>
            </FieldContent>
            <RadioGroupItem value={o.value} id={`${id}-${o.value}`} />
          </Field>
        </FieldLabel>
      ))}
    </RadioGroup>
  );
}
