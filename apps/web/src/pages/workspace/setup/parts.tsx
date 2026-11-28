import { CheckIcon, CircleAlertIcon } from "lucide-react";
import { type ReactNode, useId } from "react";
import type { FieldPath, FieldValues, UseFormReturn } from "react-hook-form";
import { ApiFailure } from "@/api";
import { AppForm, FormDialog } from "@/components/app";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { archivedWords } from "../../../retention.ts";

/** A failed load, said once, with the way to try again. What was loaded before stays on screen under it. */
export function LoadError({
  error,
  onRetry,
}: {
  error: Error | null | undefined;
  onRetry: () => void;
}) {
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <CircleAlertIcon aria-hidden="true" />
      <AlertTitle>That did not load</AlertTitle>
      <AlertDescription>{error.message}</AlertDescription>
      <div className="col-start-2 mt-2">
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </Alert>
  );
}

/** A block of a tab: its own heading, a line on what it is for, and the actions that belong to it. */
export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 id={heading} className="text-lg font-semibold">
            {title}
          </h2>
          {description ? (
            <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * A choice of two to four short options (FRM-12), drawn as a toggle group: one is always chosen, and the chosen one
 * carries a tick as well as its colour. It names itself by `labelledBy` (the legend above it).
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  labelledBy,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  labelledBy: string;
  className?: string;
}) {
  return (
    <ToggleGroup
      variant="outline"
      spacing={2}
      value={[value]}
      onValueChange={(next) => {
        const v = next[0] as T | undefined;
        if (v !== undefined) onChange(v);
      }}
      aria-labelledby={labelledBy}
      className={cn("w-full flex-wrap", className)}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          className="h-auto min-h-11 grow whitespace-normal px-3 py-1.5 aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:text-accent-foreground pointer-fine:min-h-9 sm:grow-0"
        >
          {value === o.value ? <CheckIcon aria-hidden="true" /> : null}
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** A labelled group: a legend that names the controls under it, a line of help, and the error. */
export function GroupField({
  label,
  description,
  error,
  children,
}: {
  label: string;
  description?: ReactNode;
  error?: string;
  children: (labelId: string) => ReactNode;
}) {
  const id = useId();
  const labelId = `${id}-l`;
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-2">
      <div id={labelId} className="text-sm leading-snug font-medium">
        {label}
      </div>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {children(labelId)}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A checkbox whose whole row is the target (FRM-19), with a title and an optional line under it. */
export function CheckRow({
  checked,
  onChange,
  disabled,
  title,
  description,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <FieldLabel htmlFor={id} className={className}>
      <Field orientation="horizontal" className="min-h-11 items-center">
        <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
        <FieldContent>
          <FieldTitle>{title}</FieldTitle>
          {description ? <FieldDescription>{description}</FieldDescription> : null}
        </FieldContent>
      </Field>
    </FieldLabel>
  );
}

/** The code a refusal that is about a name carries, so the form can put it on the Name field (FRM-03). */
export const ABOUT_NAME = "about_name";

/** A refusal that is about a name is turned into one that `serverFields={{ about_name: "name" }}` places on that field. */
export function aboutName(e: unknown): unknown {
  return e instanceof ApiFailure && /\bname\b/i.test(e.message)
    ? new ApiFailure(e.status, ABOUT_NAME, e.message)
    : e;
}

/** The code a refusal that is about when something starts carries, for the field that holds the date. */
export const ABOUT_DATE = "about_date";

/** A refusal about a start date ("a menu already starts that day") is placed on the date field by `{ about_date: "from" }`. */
export function aboutDate(e: unknown): unknown {
  return e instanceof ApiFailure && /\bstart/i.test(e.message)
    ? new ApiFailure(e.status, ABOUT_DATE, e.message)
    : e;
}

/** What the person is told when the server refuses: a month handed over is explained, anything else is as the server said. */
export function refusal(e: unknown): unknown {
  if (e instanceof ApiFailure) {
    const words = archivedWords(e);
    if (words) return new Error(words);
  }
  return e;
}

/**
 * A form in a dialog that is a sheet on a phone (FRM-04): the title, the form, and a footer that stays in view. It
 * closes itself when the submit succeeds; a refusal stays open and says why. `changed` adds to what the form
 * already knows is dirty, for state that lives outside it.
 */
export function FormModal<V extends FieldValues, O = V>({
  form,
  title,
  description,
  submitLabel,
  busyLabel,
  onClose,
  onSubmit,
  serverFields,
  changed = false,
  focusTitle,
  children,
}: {
  form: UseFormReturn<V, unknown, O>;
  title: string;
  description?: ReactNode;
  submitLabel: string;
  busyLabel: string;
  onClose: () => void;
  /** Resolves to false to keep the dialog open (a preview step); anything else closes it. */
  onSubmit: (values: O) => undefined | boolean | Promise<undefined | boolean>;
  serverFields?: Record<string, FieldPath<V>>;
  changed?: boolean;
  focusTitle?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const formId = `f${id.replace(/:/g, "")}`;
  return (
    <FormDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      description={description}
      formId={formId}
      submitLabel={submitLabel}
      busyLabel={busyLabel}
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty || changed}
      focusTitle={focusTitle}
    >
      <AppForm
        id={formId}
        form={form}
        serverFields={serverFields}
        onSubmit={async (values) => {
          let keep: undefined | boolean;
          try {
            keep = await onSubmit(values);
          } catch (e) {
            throw refusal(e);
          }
          if (keep !== false) onClose();
        }}
      >
        {children}
      </AppForm>
    </FormDialog>
  );
}
