import { CheckIcon, CopyIcon, TriangleAlertIcon } from "lucide-react";
import { cloneElement, type ReactElement, type ReactNode, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SOLID_DESTRUCTIVE } from "./styles";
import { toast } from "./toast";

interface Common {
  /** The control that starts it (a Button). Omit it and control the dialog with `open` instead. */
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export type ConfirmActionProps = Common &
  (
    | {
        /** Do it now and offer Undo for six seconds. For what is easy to take back. */
        level: "undo";
        onConfirm: () => void | Promise<void>;
        /** Takes it back. */
        onUndo: () => void | Promise<void>;
        /** What the toast says: "Rice removed from the menu." */
        message: string;
      }
    | {
        /** Ask first. For what is hard to take back. */
        level: "confirm";
        onConfirm: () => void | Promise<void>;
        title: string;
        description?: ReactNode;
        /** The destructive button: "Retire", never "OK". */
        confirmLabel: string;
        cancelLabel?: string;
      }
    | {
        /** Ask the person to type something exact. For what cannot be taken back. */
        level: "typed";
        onConfirm: () => void | Promise<void>;
        title: string;
        description?: ReactNode;
        confirmLabel: string;
        /** What they must type, usually the thing's name. */
        phrase: string;
        cancelLabel?: string;
      }
  );

/**
 * The severity ladder for actions (FRM-01, FRM-15): `undo` acts at once and says so with an Undo; `confirm` opens an
 * alert dialog whose default focus is "Keep it" and whose destructive button is on the right; `typed` also needs an
 * exact phrase, with a Copy button and a live "Matches" check. A refused action keeps the dialog open and says why.
 */
export function ConfirmAction(props: ConfirmActionProps) {
  const [openState, setOpenState] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [copied, setCopied] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);

  if (props.level === "undo") {
    if (!props.trigger) return null;
    const { onConfirm, onUndo, message } = props;
    return cloneElement(
      props.trigger as ReactElement<{ onClick?: () => void; disabled?: boolean }>,
      {
        disabled: busy,
        onClick: async () => {
          setBusy(true);
          try {
            await onConfirm();
            toast.undo(message, onUndo);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "That did not work. Try again.");
          } finally {
            setBusy(false);
          }
        },
      },
    );
  }

  const open = props.open ?? openState;
  const setOpen = (o: boolean) => {
    if (busy) return;
    props.onOpenChange?.(o);
    setOpenState(o);
    if (!o) {
      setError(null);
      setTyped("");
    }
  };
  const phrase = props.level === "typed" ? props.phrase : null;
  const matches = phrase === null || typed === phrase;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {props.trigger ? <AlertDialogTrigger render={props.trigger} /> : null}
      <AlertDialogContent initialFocus={phrase === null ? keep : undefined}>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-background text-destructive ring-1 ring-destructive/40">
            <TriangleAlertIcon aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          {props.description ? (
            <AlertDialogDescription>{props.description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        {phrase !== null ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              Type <strong className="font-semibold">{phrase}</strong> to confirm.
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="ml-1 align-middle"
                onClick={() => {
                  void navigator.clipboard?.writeText(phrase).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  });
                }}
              >
                {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </p>
            <Label htmlFor="confirm-typed" className="sr-only">
              Type {phrase} to confirm
            </Label>
            <Input
              id="confirm-typed"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-describedby="confirm-typed-state"
            />
            <p
              id="confirm-typed-state"
              aria-live="polite"
              className="min-h-5 text-sm text-muted-foreground"
            >
              {typed === "" ? "" : matches ? "Matches" : "Does not match yet"}
            </p>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel ref={keep} disabled={busy}>
            {props.cancelLabel ?? "Keep it"}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className={SOLID_DESTRUCTIVE}
            disabled={!matches}
            loading={busy}
            onClick={async (e) => {
              // Stay open until the action has finished, so a refusal can be shown here.
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await props.onConfirm();
                setBusy(false);
                setOpenState(false);
                props.onOpenChange?.(false);
                setTyped("");
              } catch (err) {
                setBusy(false);
                setError(err instanceof Error ? err.message : "That did not work. Try again.");
              }
            }}
          >
            {props.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
