import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { ApiFailure } from "../api.ts";
import { month as monthLabel } from "../format.ts";

/** Runs a loader and keeps its result. `reload` fetches again without blanking the screen. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: ApiFailure; loading: boolean }>({
    loading: true,
  });
  const seq = useRef(0);
  const run = useCallback(() => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    load().then(
      (data) => mine === seq.current && setState({ data, loading: false }),
      (e) =>
        mine === seq.current &&
        setState((s) => ({
          ...s,
          error: e instanceof ApiFailure ? e : new ApiFailure(0, "error", String(e)),
          loading: false,
        })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(run, [run]);
  return { ...state, reload: run };
}

/** The top of a screen: its name, a line on what it is for, and the things to do here. */
export function PageHead({
  title,
  lead,
  actions,
}: {
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div class="pagehead">
      <div class="pagehead-text">
        <h1>{title}</h1>
        {lead ? <p class="lead">{lead}</p> : null}
      </div>
      {actions ? <div class="row">{actions}</div> : null}
    </div>
  );
}

/** The top of one part of a screen. */
export function SectionHead({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div class="sechead">
      <h2>{title}</h2>
      {actions ? <div class="row">{actions}</div> : null}
    </div>
  );
}

export const Spinner = ({ label = "Loading" }: { label?: string }) => (
  <p class="muted small" role="status" aria-live="polite">
    {label}…
  </p>
);

export const Problem = ({ error }: { error: Error | string | null | undefined }) =>
  error ? (
    <div class="banner bad" role="alert">
      {typeof error === "string" ? error : error.message}
    </div>
  ) : null;

/** A form that disables itself while it sends and shows what the server said when it refuses. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, clear: () => setError(null) };
}

export function Field({
  label,
  hint,
  children,
  id,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      {children}
      {hint ? <span class="hint">{hint}</span> : null}
    </div>
  );
}

export function Form({
  onSubmit,
  children,
  error,
}: {
  onSubmit: () => unknown;
  children: ReactNode;
  error?: string | null;
}) {
  return (
    <form
      class="form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void onSubmit();
      }}
    >
      {children}
      <Problem error={error} />
    </form>
  );
}

/** A modal that returns focus where it came from and closes on Escape. */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby={titleId}>
      <div class="stack" style={{ ["--gap" as string]: "16px" }}>
        <h3 id={titleId}>{title}</h3>
        {open ? children : null}
      </div>
    </dialog>
  );
}

type ToastTone = "good" | "bad";
interface ToastMessage {
  text: string;
  tone: ToastTone;
}
const toastListeners = new Set<(m: ToastMessage) => void>();
/** A short note that something happened. A refusal says so with `'bad'`, and is announced at once. */
export const toast = (text: string, tone: ToastTone = "good") =>
  toastListeners.forEach((l) => l({ text, tone }));
export function Toaster() {
  const [message, setMessage] = useState<ToastMessage | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const on = (m: ToastMessage) => {
      setMessage(m);
      clearTimeout(timer);
      // A refusal stays long enough to be read.
      timer = setTimeout(() => setMessage(null), m.tone === "bad" ? 6000 : 3500);
    };
    toastListeners.add(on);
    return () => void toastListeners.delete(on);
  }, []);
  return message ? (
    <div
      class={`toast ${message.tone}`}
      role={message.tone === "bad" ? "alert" : "status"}
      aria-live={message.tone === "bad" ? "assertive" : "polite"}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        {message.tone === "bad" ? (
          <path
            d="M8 3v6M8 12v.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        ) : (
          <path
            d="m3.5 8.5 3 3 6-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
      {message.text}
    </div>
  ) : null;
}

export const Chip = ({
  tone,
  children,
}: {
  tone?: "good" | "warn" | "bad";
  children: ReactNode;
}) => <span class={`chip ${tone ?? ""}`}>{children}</span>;

/** One figure. The few that answer “where do I stand?” are `lead` and sit larger above the rest. */
export const Tile = ({
  label,
  value,
  projected,
  lead,
}: {
  label: string;
  value: ReactNode;
  projected?: boolean;
  lead?: boolean;
}) => (
  <div class={`tile${lead ? " lead" : ""}${projected ? " projected" : ""}`}>
    <div class="k">{label}</div>
    <div class="v">{value}</div>
  </div>
);

/** A month picker that never lists a month the workspace has no data for. */
export function MonthPicker({
  months,
  value,
  onChange,
  current,
}: {
  months: string[];
  value: string;
  onChange: (m: string) => void;
  current: string;
}) {
  return (
    <select aria-label="Month" value={value} onChange={(e) => onChange(e.target.value)} class="fit">
      {[...months].reverse().map((m) => (
        <option key={m} value={m}>
          {m === current ? `Current month (${monthLabel(m)})` : monthLabel(m)}
        </option>
      ))}
    </select>
  );
}

/** An icon that copies `text`, in the design system's icon button; it turns to a tick for a moment, and says so aloud. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"copied" | "failed" | null>(null);
  useEffect(() => {
    if (!state) return;
    const t = setTimeout(() => setState(null), 1800);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <>
      <button
        type="button"
        class="icon-btn copy"
        aria-label={label}
        title="Copy"
        data-state={state === "copied" ? "copied" : undefined}
        onClick={() =>
          void navigator.clipboard.writeText(text).then(
            () => setState("copied"),
            () => setState("failed"),
          )
        }
      >
        <svg class="i-copy" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V6a2 2 0 0 1 2-2h9" />
        </svg>
        <svg class="i-check" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
        <span class="copy-label">Copied</span>
      </button>
      <span class="sr" role="status">
        {state === "copied"
          ? "Copied to the clipboard."
          : state === "failed"
            ? "It could not be copied. Select it and press Control and C."
            : ""}
      </span>
    </>
  );
}
