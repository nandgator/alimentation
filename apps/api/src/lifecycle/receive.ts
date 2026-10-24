import { parseBundle, unsupportedRules } from '@alimentation/core';
import { FieldCipher } from '../crypto/fields.ts';
import { loadWorkspaceKeys, newWorkspaceKeys } from '../crypto/keys.ts';
import { WORKSPACE_MIGRATIONS } from '../db/migrations.generated.ts';
import { sealDsns } from '../directory.ts';
import { claimAutoInvites } from '../platform/invites.ts';
import { capacityNow, checkSlug, limitsFor, type PlatformDeps } from '../platform/workspaces.ts';
import { importBundle } from './import.ts';

const INVITE_DAYS = 90;

class Refused extends Error {}

export interface ReceiveReport {
  ok: boolean;
  dryRun: boolean;
  /** `slug_taken` and `full` are told apart from a bundle that is wrong, because the caller can act on them. */
  code: 'ok' | 'invalid' | 'slug_taken' | 'full';
  problems: string[];
  digest: string | null;
  counts: Record<string, number>;
  url: string | null;
}

/**
 * The receiving end of a move between instances. Makes a workspace of its own for
 * the bundle (new database, new keys), loads it with the same proof a local import
 * gives, and leaves the people who were in it a way back in: an invitation that is
 * claimed by signing in with the same verified email.
 */
export async function receiveWorkspace(
  p: PlatformDeps,
  input: { slug: string; bundle: unknown; dryRun: boolean },
): Promise<ReceiveReport> {
  const report: ReceiveReport = {
    ok: false,
    dryRun: input.dryRun,
    code: 'invalid',
    problems: [],
    digest: null,
    counts: {},
    url: null,
  };
  const slugProblem = checkSlug(input.slug);
  if (slugProblem) return { ...report, problems: [slugProblem] };
  const parsed = await parseBundle(input.bundle);
  if (!parsed.ok) return { ...report, problems: parsed.problems };
  const bundle = parsed.bundle;
  report.digest = bundle.manifest.digest;
  report.counts = bundle.manifest.counts;
  const unsupported = unsupportedRules(bundle);
  if (unsupported.length) return { ...report, problems: unsupported };
  if (await p.control.workspaceBySlug(input.slug))
    return { ...report, code: 'slug_taken', problems: ['That address is already taken here.'] };
  if (!(await capacityNow(p)).open)
    return {
      ...report,
      code: 'full',
      problems: ['This instance has no room for another workspace.'],
    };

  report.url = `${p.config.appOrigin}/w/${input.slug}`;
  if (input.dryRun) return { ...report, ok: true, code: 'ok' };

  const id = crypto.randomUUID();
  const provisioned = await p.placement.provision(id, WORKSPACE_MIGRATIONS);
  let inserted = false;
  try {
    const wrapped = await newWorkspaceKeys(p.keyring, id);
    const cipher = new FieldCipher(await loadWorkspaceKeys(p.keyring, id, wrapped));
    const limits = limitsFor(p.config);
    await p.control.insertWorkspace({
      id,
      slug: input.slug,
      displayName: bundle.workspace.name,
      placement: provisioned.ref,
      dsnEnc: await sealDsns(p.keyring, id, {
        app: provisioned.appUrl,
        owner: provisioned.ownerUrl,
      }),
      dataKeyWrapped: wrapped.dataKeyWrapped,
      logKeyWrapped: wrapped.logKeyWrapped,
      timeZone: bundle.workspace.timeZone,
      limits,
      createdBy: null,
    });
    inserted = true;

    const owner = p.openDb(provisioned.ownerUrl, { ephemeral: true });
    try {
      const imported = await importBundle(owner, cipher, bundle, { dryRun: false });
      if (!imported.ok) {
        report.problems = imported.problems;
        throw new Refused();
      }
      if (!p.config.dedicated)
        await owner.tx(
          async (tx) =>
            void (await tx.query('UPDATE workspace SET people_cap = $1, row_cap = $2', [
              limits.people,
              limits.rows,
            ])),
        );
    } finally {
      await owner.close();
    }

    const expiresAt = new Date(p.now().getTime() + INVITE_DAYS * 86_400_000);
    for (const m of bundle.members) {
      await p.control.createAutoInvite({
        workspaceId: id,
        personId: m.personId,
        role: m.role,
        email: m.email,
        expiresAt,
      });
    }
    // People who already have an account here get in at once; the rest on first sign-in.
    for (const email of new Set(bundle.members.map((m) => m.email.toLowerCase()))) {
      const account = await p.control.accountByEmail(email);
      if (account) await claimAutoInvites(p, account);
    }
    await p.control.event('workspace.received', id, { placement: provisioned.ref.kind });
    return { ...report, ok: true, code: 'ok' };
  } catch (e) {
    if (inserted) await p.control.deleteWorkspaceRow(id).catch(() => undefined);
    await p.placement.destroy(provisioned.ref).catch(() => undefined);
    if (e instanceof Refused) return { ...report, ok: false, code: 'invalid', url: null };
    throw e;
  }
}
