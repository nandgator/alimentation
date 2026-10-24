import { canAdmit, capacityPlan, isKnownTimeZone, UNLIMITED, type Role } from '@alimentation/core';
import type { Config } from '../config.ts';
import type { AccountRow, ControlRepo } from '../control/repo.ts';
import { FieldCipher } from '../crypto/fields.ts';
import { loadWorkspaceKeys, newWorkspaceKeys, type Keyring } from '../crypto/keys.ts';
import type { Db } from '../db/driver.ts';
import { WORKSPACE_MIGRATIONS } from '../db/migrations.generated.ts';
import { sealDsns, type Directory } from '../directory.ts';
import type { Placement, PlacementKind } from '../placement/types.ts';
import { ApiError, invalid } from '../workspace/errors.ts';
import { initializeWorkspace } from '../workspace/setup.ts';

export interface PlatformDeps {
  control: ControlRepo;
  keyring: Keyring;
  /** What creates new workspace databases. */
  placement: Placement;
  /** What removes a database of the given kind, wherever a workspace has been moved to. */
  placementFor: (kind: PlacementKind) => Placement;
  fetch: typeof fetch;
  /** `ephemeral` connections are closed by the caller and never cached. */
  openDb: (dsn: string, opts?: { ephemeral?: boolean }) => Db;
  directory: Directory;
  config: Config;
  now: () => Date;
}

const RESERVED = new Set([
  'api',
  'auth',
  'app',
  'www',
  'admin',
  'assets',
  'static',
  'login',
  'logout',
  'join',
  'new',
  'platform',
  'health',
  'status',
  'docs',
  'help',
  'about',
  'privacy',
  'terms',
  'pricing',
  'blog',
  'mail',
  'ftp',
  'root',
  'support',
]);

export function checkSlug(slug: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug))
    return 'Use 3 to 40 lowercase letters, digits or hyphens, starting and ending with a letter or digit.';
  if (/--/.test(slug)) return 'Do not use two hyphens in a row.';
  if (RESERVED.has(slug)) return 'That name is kept for the service.';
  return null;
}

export interface WorkspaceSummary {
  id: string;
  slug: string;
  name: string;
  roles: Role[];
}

export async function capacityNow(p: Pick<PlatformDeps, 'control' | 'config'>): Promise<{
  capacity: number;
  used: number;
  open: boolean;
  binding: string;
  dedicated: boolean;
}> {
  const plan = capacityPlan(p.config.capacity);
  const used = await p.control.countWorkspaces();
  // A dedicated instance is the tenant's own; the free tier's places do not apply to it.
  const dedicated = p.config.dedicated;
  return {
    capacity: plan.capacity,
    used,
    open: dedicated || canAdmit(plan, used),
    binding: dedicated ? 'dedicated' : plan.binding,
    dedicated,
  };
}

/** The caps a new workspace lives under here. */
export const limitsFor = (config: Pick<Config, 'dedicated' | 'freeLimits'>) =>
  config.dedicated ? UNLIMITED : config.freeLimits;

/**
 * Makes a workspace: a database of its own, keys of its own, its first rows, and
 * the creator signed in as its admin (and supplier, if they keep the kitchen
 * themselves). If any step fails everything made so far is taken away again.
 */
export async function createWorkspace(
  p: PlatformDeps,
  account: AccountRow,
  input: { slug: string; name: string; timeZone: string; alsoSupplier: boolean },
): Promise<WorkspaceSummary> {
  const slugProblem = checkSlug(input.slug);
  if (slugProblem) throw invalid(slugProblem);
  const name = input.name.trim();
  if (!name || name.length > 120)
    throw invalid('Give the workspace a name of up to 120 characters.');
  if (!isKnownTimeZone(input.timeZone)) throw invalid(`"${input.timeZone}" is not a time zone`);

  const cap = await capacityNow(p);
  if (!cap.open) {
    throw new ApiError(
      503,
      'full',
      'The free places are all taken for now. You can bring your own database to start now, or try again later.',
    );
  }
  if (await p.control.workspaceBySlug(input.slug))
    throw new ApiError(409, 'slug_taken', 'That address is taken.');

  const id = crypto.randomUUID();
  const provisioned = await p.placement.provision(id, WORKSPACE_MIGRATIONS);
  let inserted = false;
  try {
    const wrapped = await newWorkspaceKeys(p.keyring, id);
    const keys = await loadWorkspaceKeys(p.keyring, id, wrapped);
    const cipher = new FieldCipher(keys);
    await p.control.insertWorkspace({
      id,
      slug: input.slug,
      displayName: name,
      placement: provisioned.ref,
      dsnEnc: await sealDsns(p.keyring, id, {
        app: provisioned.appUrl,
        owner: provisioned.ownerUrl,
      }),
      dataKeyWrapped: wrapped.dataKeyWrapped,
      logKeyWrapped: wrapped.logKeyWrapped,
      timeZone: input.timeZone,
      limits: limitsFor(p.config),
      createdBy: account.id,
    });
    inserted = true;

    const owner = p.openDb(provisioned.ownerUrl, { ephemeral: true });
    let ids;
    try {
      ids = await initializeWorkspace(owner, cipher, {
        name,
        timeZone: input.timeZone,
        adminName: account.displayName ?? account.email,
        alsoSupplier: input.alsoSupplier,
        limits: p.config.dedicated ? null : p.config.freeLimits,
      });
    } finally {
      await owner.close();
    }

    const app = p.openDb(provisioned.appUrl, { ephemeral: true });
    try {
      for (const personId of [ids.adminId, ids.supplierId]) {
        if (personId)
          await app.tx(
            async (tx) =>
              void (await tx.query('SELECT bind_account($1, $2)', [personId, account.id])),
          );
      }
    } finally {
      await app.close();
    }
    const roles: Role[] = ['admin'];
    await p.control.addMembership(account.id, id, ids.adminId, 'admin');
    if (ids.supplierId) {
      roles.push('supplier');
      await p.control.addMembership(account.id, id, ids.supplierId, 'supplier');
    }
    await p.control.event('workspace.created', id, { placement: provisioned.ref.kind });
    return { id, slug: input.slug, name, roles };
  } catch (e) {
    if (inserted) await p.control.deleteWorkspaceRow(id).catch(() => undefined);
    await p.placement.destroy(provisioned.ref).catch(() => undefined);
    if ((e as { code?: string }).code === '23505')
      throw new ApiError(409, 'slug_taken', 'That address is taken.');
    throw e;
  }
}
