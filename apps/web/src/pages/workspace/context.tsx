import { createContext, useContext } from 'react';
import type { BootstrapDto, Role } from '@alimentation/core';

export interface Workspace {
  slug: string;
  boot: BootstrapDto;
  /** The role being acted as. */
  role: Role;
  /** False while the workspace is being moved or has moved. */
  writable: boolean;
  fromDevice: boolean;
  api: string;
  reload(): void;
  nameOf(personId: string): string;
}

const Ctx = createContext<Workspace | null>(null);
export const WorkspaceProvider = Ctx.Provider;
export function useWorkspace(): Workspace {
  const w = useContext(Ctx);
  if (!w) throw new Error('outside a workspace');
  return w;
}
