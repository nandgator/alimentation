import type { Limits } from '@alimentation/core';
import type { FieldCipher } from '../crypto/fields.ts';
import type { Db } from '../db/driver.ts';

export interface NewWorkspace {
  name: string;
  timeZone: string;
  adminName: string;
  /** A kitchen owner who is also the supplier gets both roles, as two people. */
  alsoSupplier: boolean;
  /** Null on a dedicated workspace, which has no caps. */
  limits: Limits | null;
}

/**
 * Writes a new workspace's first rows. Runs as the database owner, which is the
 * only role allowed to create a workspace; the application role never can.
 */
export async function initializeWorkspace(
  ownerDb: Db,
  cipher: FieldCipher,
  input: NewWorkspace,
): Promise<{ adminId: string; supplierId: string | null }> {
  const adminId = crypto.randomUUID();
  const supplierId = input.alsoSupplier ? crypto.randomUUID() : null;
  await ownerDb.tx(async (tx) => {
    await tx.query(
      'INSERT INTO workspace (name, time_zone, people_cap, row_cap) VALUES ($1, $2, $3, $4)',
      [input.name, input.timeZone, input.limits?.people ?? null, input.limits?.rows ?? null],
    );
    for (const [id, role] of [
      [adminId, 'admin'],
      [supplierId, 'supplier'],
    ] as const) {
      if (!id) continue;
      await tx.query(`INSERT INTO person (id, role, name_enc) VALUES ($1, $2, $3)`, [
        id,
        role,
        await cipher.enc('person', 'name_enc', id, input.adminName),
      ]);
    }
  });
  return { adminId, supplierId };
}
