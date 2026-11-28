import type { Role } from "@alimentation/core";
import type { Status } from "@/components/app";
import { Badge } from "@/components/ui/badge";
import { serviceName } from "../../../catalogue.ts";
import { takenOn } from "../../../enrolment.ts";
import { useWorkspace } from "../context.tsx";
import { ROLE_LABEL } from "../sections.ts";
import { isDisabled, type Member } from "./model.ts";

export const accountStatus = (m: Member): Status =>
  isDisabled(m) ? "disabled" : m.rows.some((r) => r.linked) ? "active" : "invited";

/** What a person eats today, in words: the services they take, or "None". Empty for the people who do not eat. */
export function useEats() {
  const ws = useWorkspace();
  return (m: Member): string => {
    const row = m.rows.find((r) => r.role === "consumer");
    if (!row) return "";
    const ids = takenOn(
      ws.boot.enrolments.filter((e) => e.personId === row.id),
      ws.boot.today,
    );
    return ids.map((id) => serviceName(ws.boot, id)).join(", ") || "None";
  };
}

export function RoleBadges({ roles }: { roles: Role[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <Badge key={r} variant="outline">
          {ROLE_LABEL[r]}
        </Badge>
      ))}
    </span>
  );
}
