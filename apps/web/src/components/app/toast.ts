import { toast as sonner } from "sonner";

const DURATION = 6000;

interface ToastAction {
  label: string;
  onClick: () => void;
}
interface ToastOptions {
  action?: ToastAction;
  description?: string;
}

const base = { duration: DURATION, closeButton: true } as const;

/** Toasts, one voice (FRM-10): six seconds, a close button, and an action when there is one. The `<Toaster />` is mounted once, by the shell. */
export const toast = {
  success: (message: string, opts: ToastOptions = {}) =>
    sonner.success(message, { ...base, ...opts }),
  error: (message: string, opts: ToastOptions = {}) => sonner.error(message, { ...base, ...opts }),
  info: (message: string, opts: ToastOptions = {}) => sonner(message, { ...base, ...opts }),
  /** The action has already happened; this says so and offers to take it back. */
  undo: (message: string, undo: () => void | Promise<void>) =>
    sonner.success(message, {
      ...base,
      action: { label: "Undo", onClick: () => void undo() },
    }),
  dismiss: (id?: string | number) => sonner.dismiss(id),
};
