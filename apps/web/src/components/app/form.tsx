import { zodResolver } from "@hookform/resolvers/zod";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Control,
  Controller,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
  FormProvider,
  type UseFormReturn,
  useForm,
  useFormContext,
} from "react-hook-form";
import type { z } from "zod";
import { ApiFailure } from "@/api";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * A form's state (FRM-02): zod for the rules, and validation that waits for the person to leave a field, then
 * follows them as they fix it (`mode: "onTouched"`). Read the parsed values in `onSubmit` of AppForm.
 */
export function useAppForm<S extends z.ZodType<FieldValues, FieldValues>>(
  schema: S,
  defaultValues: z.input<S>,
) {
  return useForm<z.input<S>, unknown, z.output<S>>({
    // The resolver's typing across zod versions is looser than useForm's.
    // biome-ignore lint/suspicious/noExplicitAny: see above
    resolver: zodResolver(schema as any) as any,
    defaultValues: defaultValues as never,
    mode: "onTouched",
    reValidateMode: "onChange",
  });
}

interface FormMeta {
  fields: Map<string, { id: string; label: string }>;
  setField(name: string, info: { id: string; label: string } | null): void;
}
const MetaContext = createContext<FormMeta | null>(null);

/** More fields than this and a failed submit gathers the problems into a summary that takes focus. */
const SUMMARY_FROM = 3;

/**
 * The `<form>` (FRM-02, FRM-03): `noValidate`, so the app's own messages are the only ones; the submit is guarded
 * against a second press; a failed submit puts the errors in a summary when the form has more than three fields,
 * and focuses the first bad field when it has fewer. A refusal thrown by `onSubmit` is placed on its field by
 * `serverFields` (see `mapServerError`), or else shown at the top of the form.
 */
export function AppForm<V extends FieldValues, O = V>({
  form,
  onSubmit,
  serverFields,
  children,
  className,
  id,
}: {
  form: UseFormReturn<V, unknown, O>;
  onSubmit: (values: O) => void | Promise<void>;
  /** Server error code to the field it is about. */
  serverFields?: Record<string, FieldPath<V>>;
  children: ReactNode;
  className?: string;
  /** Lets a button outside the form (a sticky footer) submit it with `form="…"`. */
  id?: string;
}) {
  const fields = useRef(new Map<string, { id: string; label: string }>()).current;
  const [count, setCount] = useState(0);
  const [summary, setSummary] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const meta = useMemo<FormMeta>(
    () => ({
      fields,
      setField(name, info) {
        if (info) fields.set(name, info);
        else fields.delete(name);
        setCount(fields.size);
      },
    }),
    [fields],
  );

  const run = form.handleSubmit(
    async (values) => {
      setSummary(false);
      form.clearErrors("root");
      try {
        await onSubmit(values);
      } catch (e) {
        if (!mapServerError(form, e, serverFields)) {
          form.setError("root", {
            message: e instanceof Error ? e.message : "Something went wrong. Try again.",
          });
        }
      }
    },
    () => {
      if (fields.size > SUMMARY_FROM) {
        setSummary(true);
        // After react-hook-form has moved focus to the first bad field, so the summary has the last word.
        setTimeout(() => summaryRef.current?.focus(), 50);
      }
    },
  );

  const errors = form.formState.errors;
  const rootMessage = errors.root?.message as string | undefined;
  const listed = Object.entries(errors)
    .filter(([name]) => name !== "root")
    .map(([name, e]) => ({
      name,
      message: (e as { message?: string } | undefined)?.message,
      info: fields.get(name),
    }))
    .filter((e) => e.message);

  return (
    <FormProvider {...(form as unknown as UseFormReturn<FieldValues>)}>
      <MetaContext.Provider value={meta}>
        <form
          id={id}
          noValidate
          className={cn("flex flex-col gap-5", className)}
          onSubmit={(e: FormEvent) => {
            if (form.formState.isSubmitting) {
              e.preventDefault();
              return;
            }
            void run(e as never);
          }}
        >
          {rootMessage ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/40 bg-background p-3 text-sm text-destructive"
            >
              {rootMessage}
            </div>
          ) : null}
          {summary && listed.length > 0 && count > SUMMARY_FROM ? (
            <div
              ref={summaryRef}
              tabIndex={-1}
              role="alert"
              className="rounded-lg border border-destructive/40 bg-background p-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <p className="font-medium text-destructive">
                {listed.length === 1
                  ? "1 thing needs fixing"
                  : `${listed.length} things need fixing`}
              </p>
              <ul className="mt-1 list-disc pl-5">
                {listed.map((e) => (
                  <li key={e.name}>
                    <a
                      className="underline underline-offset-2"
                      href={`#${e.info?.id ?? e.name}`}
                      onClick={(ev) => {
                        ev.preventDefault();
                        document.getElementById(e.info?.id ?? e.name)?.focus();
                      }}
                    >
                      {e.info?.label ?? e.name}
                    </a>
                    : {e.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {children}
        </form>
      </MetaContext.Provider>
    </FormProvider>
  );
}

export interface FormControlProps<V extends FieldValues, N extends FieldPath<V>>
  extends ControllerRenderProps<V, N> {
  id: string;
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
}

/**
 * A labelled field (FRM-02): label above, optional hint, the control, and the error under it with `aria-invalid`
 * and `aria-describedby` set on the control. Give it a render function that spreads `field` onto the control:
 * `<FormField name="name" label="Name">{(field) => <Input {...field} />}</FormField>`.
 * For a control with its own value shape, use `field.value` and `field.onChange`.
 */
export function FormField<V extends FieldValues, N extends FieldPath<V> = FieldPath<V>>({
  name,
  label,
  description,
  required,
  control,
  children,
  className,
}: {
  name: N;
  label: string;
  description?: ReactNode;
  required?: boolean;
  control?: Control<V>;
  children: (field: FormControlProps<V, N>) => ReactNode;
  className?: string;
}) {
  const ctx = useFormContext<V>();
  const meta = useContext(MetaContext);
  const uid = useId();
  const id = `f${uid.replace(/:/g, "")}`;
  useEffect(() => {
    meta?.setField(name, { id, label });
    return () => meta?.setField(name, null);
  }, [meta, name, id, label]);
  return (
    <Controller
      name={name}
      control={control ?? ctx.control}
      render={({ field, fieldState }) => {
        const error = fieldState.error?.message;
        const describedBy =
          [description ? `${id}-d` : null, error ? `${id}-e` : null].filter(Boolean).join(" ") ||
          undefined;
        return (
          <Field className={className} data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={id}>
              {label}
              {required ? <span aria-hidden="true"> *</span> : null}
            </FieldLabel>
            {children({
              ...field,
              id,
              "aria-invalid": error ? true : undefined,
              "aria-describedby": describedBy,
            })}
            {description ? <FieldDescription id={`${id}-d`}>{description}</FieldDescription> : null}
            {error ? <FieldError id={`${id}-e`}>{error}</FieldError> : null}
          </Field>
        );
      }}
    />
  );
}

/** A submit button that shows it is busy while the form submits (FRM-10). */
export function SubmitButton({
  children,
  busy = "Saving…",
  form,
  ...props
}: {
  children: ReactNode;
  busy?: string;
  /** The form's `id`, for a button that sits outside it. */
  form?: string;
  disabled?: boolean;
  className?: string;
}) {
  const ctx = useFormContext();
  const submitting = ctx?.formState.isSubmitting ?? false;
  return (
    <Button type="submit" form={form} loading={submitting} loadingText={busy} {...props}>
      {children}
    </Button>
  );
}

/**
 * Places a refusal from the server on the field it is about (FRM-03), and focuses it. The server's `code` is looked
 * up in `map`; failing that, a validation issue's `path` that names a field is used. Returns false when nothing
 * matched, so the caller can show the message some other way.
 */
export function mapServerError<V extends FieldValues>(
  form:
    | Pick<UseFormReturn<V, unknown, never>, "setError" | "getValues">
    | UseFormReturn<V, unknown, unknown>,
  error: unknown,
  map: Record<string, FieldPath<V>> = {},
): boolean {
  if (!(error instanceof ApiFailure)) return false;
  const has = (n: string) => n in (form.getValues() as object);
  let field: FieldPath<V> | undefined = map[error.code];
  let message = error.message;
  if (!field) {
    const issue = error.issues.find((i) => i.path && has(i.path.split(".")[0] ?? ""));
    if (issue) {
      field = issue.path as FieldPath<V>;
      message = issue.message;
    }
  }
  if (!field) return false;
  form.setError(field, { type: "server", message }, { shouldFocus: true });
  return true;
}

/** Serial id for tests and for linking controls that are not in a FormField. */
export const useFieldId = () => `f${useId().replace(/:/g, "")}`;
