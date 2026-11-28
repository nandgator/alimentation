import {
  BanIcon,
  CheckCheckIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleDashedIcon,
  ClockIcon,
  type LucideIcon,
  MailIcon,
  TriangleAlertIcon,
  WalletIcon,
  ZapIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type Status =
  | "paid"
  | "owed"
  | "overdue"
  | "pending"
  | "confirmed"
  | "disputed"
  | "projected"
  | "active"
  | "invited"
  | "disabled";

const STATUS: Record<Status, { label: string; icon: LucideIcon; tone: string }> = {
  paid: { label: "Paid", icon: CheckCircle2Icon, tone: "bg-success-soft text-success-foreground" },
  owed: { label: "Owed", icon: WalletIcon, tone: "bg-warning-soft text-warning-foreground" },
  overdue: {
    label: "Overdue",
    icon: CircleAlertIcon,
    tone: "border-destructive/40 bg-background text-destructive",
  },
  pending: { label: "Pending", icon: ClockIcon, tone: "bg-warning-soft text-warning-foreground" },
  confirmed: {
    label: "Confirmed",
    icon: CheckCheckIcon,
    tone: "bg-success-soft text-success-foreground",
  },
  disputed: {
    label: "Disputed",
    icon: TriangleAlertIcon,
    tone: "border-destructive/40 bg-background text-destructive",
  },
  projected: { label: "Projected", icon: CircleDashedIcon, tone: "bg-muted text-muted-foreground" },
  active: { label: "Active", icon: ZapIcon, tone: "bg-success-soft text-success-foreground" },
  invited: { label: "Invited", icon: MailIcon, tone: "bg-info-soft text-info-foreground" },
  disabled: { label: "Disabled", icon: BanIcon, tone: "bg-muted text-muted-foreground" },
};

/** A status, always an icon and a word, never colour alone and never a dot (DAT-05). */
export function StatusBadge({
  status,
  label,
  className,
}: {
  status: Status;
  /** Replaces the word ("Paid in part"); the icon and tone stay. */
  label?: string;
  className?: string;
}) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <Badge variant="secondary" className={cn(s.tone, className)} data-status={status}>
      <Icon aria-hidden="true" data-icon="inline-start" />
      {label ?? s.label}
    </Badge>
  );
}
