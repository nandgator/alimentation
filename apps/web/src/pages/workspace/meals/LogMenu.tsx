import {
  CalendarOffIcon,
  ChevronDownIcon,
  PlusIcon,
  UtensilsCrossedIcon,
  WheatIcon,
} from "lucide-react";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Intent } from "../../../logForm.ts";
import { INTENT_COPY } from "./LogDialog.tsx";

const ICON = {
  skip: CalendarOffIcon,
  extra: PlusIcon,
  switch: UtensilsCrossedIcon,
  off: WheatIcon,
} as const;
export const intentIcon = (i: Intent) => ICON[i];

/**
 * The one button that logs something: a menu of what can be done when there is more than one thing (an admin's
 * "Log a meal"), and the thing itself when there is only one (the cook's "Mark the kitchen off").
 */
export function LogMenu({
  intents,
  onPick,
  disabled,
  label = "Log a meal",
  ...props
}: {
  intents: Intent[];
  onPick: (intent: Intent) => void;
  disabled?: boolean;
  label?: string;
} & Omit<ComponentProps<typeof Button>, "onClick" | "children">) {
  const [only] = intents;
  if (intents.length === 0 || only === undefined) return null;
  if (intents.length === 1) {
    const Icon = intentIcon(only);
    return (
      <Button disabled={disabled} onClick={() => onPick(only)} {...props}>
        <Icon aria-hidden="true" data-icon="inline-start" />
        {INTENT_COPY[only].action}
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button disabled={disabled} {...props} />}>
        {label}
        <ChevronDownIcon aria-hidden="true" data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {intents.map((i) => {
          const Icon = intentIcon(i);
          return (
            <DropdownMenuItem
              key={i}
              className="min-h-11 pointer-fine:min-h-8"
              onClick={() => onPick(i)}
            >
              <Icon aria-hidden="true" />
              {INTENT_COPY[i].action}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
