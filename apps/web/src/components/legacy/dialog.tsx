import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";

/**
 * A modal on Base UI's dialog: focus is held inside and returned to what opened it, Escape closes it, and
 * its title names it. The `dialog` class is what the sheet styles.
 */
export function Modal({
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
  return (
    <BaseDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="dialog-backdrop" />
        <BaseDialog.Popup className="dialog">
          <div className="stack" style={{ ["--gap" as string]: "16px" }}>
            <BaseDialog.Title render={<h3>{title}</h3>} />
            {children}
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
