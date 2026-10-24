import type { Role } from '@alimentation/core';
import type { Db, Tx } from '../db/driver.ts';

export interface Actor {
  personId: string;
  role: Role;
}

/**
 * Runs `fn` in one transaction with the actor stated the way the database's
 * row-level security expects: transaction-local settings that vanish at commit.
 */
export async function asActor<T>(
  db: Db,
  actor: Actor | null,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.tx(async (tx) => {
    if (actor) {
      await tx.query(
        `SELECT set_config('app.role', $1, true), set_config('app.person_id', $2, true)`,
        [actor.role, actor.personId],
      );
    }
    return fn(tx);
  });
}

/** Who each of a signed-in account's roles is in this workspace. */
export async function resolveActors(db: Db, accountId: string): Promise<Actor[]> {
  return db.tx(async (tx) => {
    const rows = await tx.query<{ person_id: string; role: Role }>(
      'SELECT person_id, role FROM resolve_actor($1)',
      [accountId],
    );
    return rows.map((r) => ({ personId: r.person_id, role: r.role }));
  });
}
