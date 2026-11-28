import { CloudOffIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { useWorkspace } from "../pages/workspace/context.tsx";

/**
 * One bar above the page for the state the kitchen is in: offline, being moved, handing over older months, or
 * moved. It has a fixed height, so nothing under it moves when its words change. (What is not set up yet is
 * not here: the admin's Home carries that as a checklist.)
 */
export function StatusBar() {
  const { boot, fromDevice } = useWorkspace();
  const state = boot.workspace.state;
  const note = fromDevice
    ? {
        icon: CloudOffIcon,
        text: "You are offline. This is the last statement saved on this device.",
      }
    : state === "MIGRATING"
      ? {
          icon: TriangleAlertIcon,
          text: "This kitchen is being moved. It is read-only until the move finishes.",
        }
      : state === "ARCHIVING"
        ? {
            icon: TriangleAlertIcon,
            text: "Older months are being handed over. The kitchen is read-only for a moment.",
          }
        : state === "MOVED"
          ? {
              icon: InfoIcon,
              text: "This kitchen has moved. This copy is read-only and will be removed.",
            }
          : null;
  if (!note) return null;
  const Icon = note.icon;
  return (
    <div
      role="status"
      className="flex min-h-10 items-center gap-2 border-b bg-warning-soft px-4 py-2 text-sm text-warning-foreground lg:px-6"
    >
      <Icon className="size-4 shrink-0" />
      <p>
        {note.text}
        {state === "MOVED" && boot.workspace.movedTo ? (
          <>
            {" "}
            <a className="font-medium underline underline-offset-2" href={boot.workspace.movedTo}>
              Open it at {boot.workspace.movedTo}
            </a>
          </>
        ) : null}
      </p>
    </div>
  );
}
