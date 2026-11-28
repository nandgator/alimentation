import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsNarrow } from "@/hooks/use-media-query";
import { SOLID_DESTRUCTIVE } from "./styles";

export interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** The form body. Give its `<AppForm>` the `id` below so the footer's button can submit it. */
  children: ReactNode;
  /** The id of the form inside, so the sticky footer's primary button submits it. */
  formId: string;
  submitLabel?: string;
  /** Replaces the label while the form submits. */
  busyLabel?: string;
  submitting?: boolean;
  submitDisabled?: boolean;
  cancelLabel?: string;
  /** True when the form has unsaved changes: closing then asks "Discard changes?". */
  dirty?: boolean;
  /** Called after the person confirms discarding, before the dialog closes. Reset the form here. */
  onDiscard?: () => void;
}

/**
 * A form in a dialog (FRM-04, FRM-17, NAV-16). On ≥768px a Dialog; below it a full-height bottom Sheet. Either way:
 * a header with a close button, a body that scrolls, and a footer that stays in view with the secondary action first
 * and the primary last. A dirty form asks "Discard changes?" before it closes by any route (Esc, the scrim, Cancel,
 * the close button, the Back button). Opening adds a history entry, so Back closes it rather than leaving the page.
 * On a phone, focus starts on the title, so the keyboard does not open until a field is chosen.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  formId,
  submitLabel = "Save",
  busyLabel = "Saving…",
  submitting = false,
  submitDisabled = false,
  cancelLabel = "Cancel",
  dirty = false,
  onDiscard,
}: FormDialogProps) {
  const narrow = useIsNarrow();
  const [asking, setAsking] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const token = useId();
  const pushed = useRef(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // Read when Back is pressed, so a caller that passes a new function on every render does not set the entry up again.
  const closeRef = useRef(onOpenChange);
  closeRef.current = onOpenChange;

  const finish = useCallback(() => {
    setAsking(false);
    onOpenChange(false);
  }, [onOpenChange]);

  /** Every way of closing comes here: it closes, or asks first. */
  const request = useCallback(
    (next: boolean) => {
      if (next) return onOpenChange(true);
      if (dirtyRef.current && !submitting) setAsking(true);
      else onOpenChange(false);
    },
    [onOpenChange, submitting],
  );

  // The history entry: Back closes the dialog (asking first if it is dirty and keeping it open meanwhile).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      window.history.pushState({ formDialog: token }, "");
      pushed.current = true;
    }, 0);
    const onPop = () => {
      if (!pushed.current) return;
      pushed.current = false;
      if (dirtyRef.current) {
        window.history.pushState({ formDialog: token }, "");
        pushed.current = true;
        setAsking(true);
      } else closeRef.current(false);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      clearTimeout(t);
      window.removeEventListener("popstate", onPop);
      // Only its own entry is taken back: a page the form moved on to (a new kitchen's, say) is left where it is.
      if (pushed.current) {
        pushed.current = false;
        if (window.history.state?.formDialog === token) window.history.back();
      }
    };
  }, [open, token]);

  const footer = (
    <div className="flex flex-col-reverse gap-2 border-t bg-popover p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
      <Button type="button" variant="outline" onClick={() => request(false)}>
        {cancelLabel}
      </Button>
      <Button
        type="submit"
        form={formId}
        loading={submitting}
        loadingText={busyLabel}
        disabled={submitDisabled}
      >
        {submitLabel}
      </Button>
    </div>
  );

  const guard = (
    <AlertDialog open={asking} onOpenChange={setAsking}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Discard changes?</AlertDialogTitle>
          <AlertDialogDescription>What you entered here will be lost.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className={SOLID_DESTRUCTIVE}
            onClick={() => {
              onDiscard?.();
              finish();
            }}
          >
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return (
    <>
      {narrow ? (
        <Sheet open={open} onOpenChange={request}>
          <SheetContent side="bottom" className="h-dvh max-h-dvh gap-0" initialFocus={titleRef}>
            <SheetHeader className="border-b pr-14">
              <SheetTitle ref={titleRef} tabIndex={-1} className="text-lg outline-none">
                {title}
              </SheetTitle>
              {description ? <SheetDescription>{description}</SheetDescription> : null}
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
            {footer}
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={request}>
          <DialogContent className="flex max-h-[85dvh] flex-col gap-0 p-0 sm:max-w-lg">
            <DialogHeader className="p-4 pr-14">
              <DialogTitle className="text-lg">{title}</DialogTitle>
              {description ? <DialogDescription>{description}</DialogDescription> : null}
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
            {footer}
          </DialogContent>
        </Dialog>
      )}
      {guard}
    </>
  );
}
