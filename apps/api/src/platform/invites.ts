import type { Role } from '@alimentation/core';
import type { AccountRow } from '../control/repo.ts';
import { randomBytes, toBase64Url } from '../crypto/aead.ts';
import type { WorkspaceHandle } from '../directory.ts';
import type { Actor } from '../workspace/context.ts';
import { ApiError, forbidden, invalid } from '../workspace/errors.ts';
import type { PlatformDeps } from './workspaces.ts';

const DAYS = 7;

const hash = async (token: string) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));

/**
 * An invitation names an email and a person already created in the workspace. The
 * link is the only secret; only its hash is stored. Sending it is the admin's job
 * (a message to the person), so the platform needs no outbound email.
 */
export async function createInvite(
  p: PlatformDeps,
  handle: WorkspaceHandle,
  actor: Actor,
  inviter: AccountRow,
  personId: string,
  email: string,
): Promise<{ link: string; expiresAt: string; role: Role }> {
  const address = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw invalid('Enter a valid email address.');
  const role = await handle.service.roleOf(actor, personId);
  const token = toBase64Url(randomBytes(24));
  const expiresAt = new Date(p.now().getTime() + DAYS * 86_400_000);
  await p.control.createInvite({
    workspaceId: handle.row.id,
    personId,
    role,
    email: address,
    tokenHash: await hash(token),
    expiresAt,
    createdBy: inviter.id,
  });
  return { link: `${p.config.appOrigin}/join#${token}`, expiresAt: expiresAt.toISOString(), role };
}

export async function acceptInvite(
  p: PlatformDeps,
  account: AccountRow,
  token: string,
): Promise<{ slug: string; role: Role }> {
  const inv = await p.control.inviteByHash(await hash(token));
  if (!inv || inv.acceptedAt || new Date(inv.expiresAt).getTime() < p.now().getTime()) {
    throw new ApiError(
      410,
      'invite_invalid',
      'That invitation is no longer valid. Ask for a new one.',
    );
  }
  if (inv.email !== account.email) {
    throw forbidden(
      `This invitation was sent to a different email address. Sign in with the address it was sent to.`,
    );
  }
  const handle = await p.directory.byId(inv.workspaceId);
  if (!handle || handle.info.state !== 'ACTIVE')
    throw new ApiError(
      409,
      'unavailable',
      'That workspace is not accepting new members right now.',
    );
  await handle.appDb.tx(
    async (tx) => void (await tx.query('SELECT bind_account($1, $2)', [inv.personId, account.id])),
  );
  await p.control.addMembership(account.id, handle.row.id, inv.personId, inv.role);
  await p.control.markInviteAccepted(inv.id);
  return { slug: handle.row.slug, role: inv.role };
}
