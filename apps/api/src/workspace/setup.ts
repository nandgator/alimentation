import type { FieldCipher } from "../crypto/fields.ts";
import type { Db } from "../db/driver.ts";

/** What a workspace's database enforces; null is no cap. */
export interface Caps {
  people: number | null;
  rows: number | null;
}

export interface NewWorkspace {
  name: string;
  timeZone: string;
  adminName: string;
  /** A kitchen owner who is also the supplier gets both roles, as two people. */
  alsoSupplier: boolean;
  caps: Caps;
  /** Whether the kitchen puts a price on its meals. Chosen here, once: the database refuses any later change. */
  moneyEnabled: boolean;
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
      "INSERT INTO workspace (name, time_zone, people_cap, row_cap, money_enabled) VALUES ($1, $2, $3, $4, $5)",
      [input.name, input.timeZone, input.caps.people, input.caps.rows, input.moneyEnabled],
    );
    for (const [id, role] of [
      [adminId, "admin"],
      [supplierId, "supplier"],
    ] as const) {
      if (!id) continue;
      await tx.query(`INSERT INTO person (id, role, name_enc) VALUES ($1, $2, $3)`, [
        id,
        role,
        await cipher.enc("person", "name_enc", id, input.adminName),
      ]);
    }
  });
  return { adminId, supplierId };
}
