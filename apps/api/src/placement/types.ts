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

/** For a database that is not ours to drop, the connection that lets us remove only our own objects from it. */
export interface Credentials {
  ownerUrl: string;
  appUrl: string;
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
  destroy(ref: PlacementRef, creds?: Credentials): Promise<void>;
  exists(ref: PlacementRef, creds?: Credentials): Promise<boolean>;
}

export function randomSecret(bytes = 24): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
