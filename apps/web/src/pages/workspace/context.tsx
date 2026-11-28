import type { BootstrapDto, Role } from "@alimentation/core";
import { createContext, useContext } from "react";

export interface Workspace {
  slug: string;
  boot: BootstrapDto;
  /** The role being acted as. */
  role: Role;
  /** False while the workspace is being moved or has moved. */
  writable: boolean;
  /** Whether the kitchen tracks money. When it does not, there are no prices, bills or payments to show. */
  money: boolean;
  fromDevice: boolean;
  /** The kitchen's own address, `/w/{slug}`: what every link inside it starts with. */
  base: string;
  api: string;
  /** Whether the statement is being fetched again while the old one stays on screen. */
  refreshing: boolean;
  /** Fetches the statement again, keeping what is shown until the new one arrives. */
  reload(): void;
  /** Acts as another of the person's roles: no page load, and the new role's home opens. */
  switchRole(role: Role): void;
  nameOf(personId: string): string;
}

const Ctx = createContext<Workspace | null>(null);
export const WorkspaceProvider = Ctx.Provider;
export function useWorkspace(): Workspace {
  const w = useContext(Ctx);
  if (!w) throw new Error("outside a workspace");
  return w;
}
