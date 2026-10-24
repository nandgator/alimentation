import type { Migration } from '../db/migrate.ts';

/**
 * Where a workspace's database lives. A placement creates it, hands back the two
 * connection strings (the owner migrates and wipes; the application role is what
 * requests use), and destroys it.
 */

export type PlacementKind = 'pg-database' | 'neon-project' | 'external';

export interface PlacementRef {
  kind: PlacementKind;
  /** Whatever the placement needs to find the database again; opaque to everyone else. */
  data: Record<string, string>;
}

export interface Provisioned {
  ref: PlacementRef;
  ownerUrl: string;
  appUrl: string;
}

export interface Placement {
  readonly kind: PlacementKind;
  provision(workspaceId: string, migrations: readonly Migration[]): Promise<Provisioned>;
  /** Removes the database and its roles. Succeeds when it is already gone. */
  destroy(ref: PlacementRef): Promise<void>;
  exists(ref: PlacementRef): Promise<boolean>;
}

export function randomSecret(bytes = 24): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
