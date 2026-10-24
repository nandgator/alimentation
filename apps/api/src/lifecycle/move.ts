import {
  UNLIMITED,
  localNow,
  unsupportedRules,
  type Bundle,
  type Limits,
} from '@alimentation/core';
import type { AccountRow } from '../control/repo.ts';
import { FieldCipher } from '../crypto/fields.ts';
import { loadWorkspaceKeys, newWorkspaceKeys } from '../crypto/keys.ts';
import type { Db } from '../db/driver.ts';
import { readDsns, sealDsns, type WorkspaceHandle } from '../directory.ts';
import {
  ExternalPlacement,
  prepareExternalTarget,
  type TargetCheck,
} from '../placement/external.ts';
import type { PlatformDeps } from '../platform/workspaces.ts';
import { ApiError, invalid } from '../workspace/errors.ts';
import { exportWorkspace } from './bundleio.ts';
import { AUDITED, importBundle, type ImportReport } from './import.ts';
import { targetProblem } from './targets.ts';
import { UNDO_DAYS } from './wipe.ts';

export type MoveTarget =
  { kind: 'database'; url: string } | { kind: 'instance'; url: string; token: string };

export interface MovePreview {
  ok: boolean;
  target: MoveTarget['kind'];
  problems: string[];
  counts: Record<string, number>;
  digest: string | null;
  /** What will happen, in the order it happens, in words for the person deciding. */
  steps: string[];
}

export interface MoveResult {
  target: MoveTarget['kind'];
  digest: string;
  counts: Record<string, number>;
  /** Where the workspace can now be found, for a move to another instance. */
  movedTo: string | null;
  /** When the old copy will have been removed, unless it is removed sooner. */
  oldCopyRemovedBy: string;
}

const DAY = 86_400_000;

/** Stops all writing to a workspace, waiting for any write already under way to finish first. */
export async function freezeWorkspace(owner: Db, waitSeconds = 10): Promise<void> {
  const wait = Math.max(1, Math.trunc(waitSeconds));
  await owner.tx(async (tx) => {
    await tx.query(`SET LOCAL lock_timeout = '${wait}s'`);
    // Takes a lock that waits for writers in flight; once held, new writes see the flag below.
    await tx.query(
      `LOCK TABLE workspace, ${AUDITED.filter((t) => t !== 'workspace').join(', ')} IN SHARE ROW EXCLUSIVE MODE`,
    );
    await tx.query('UPDATE workspace SET read_only = true');
  });
}

export async function unfreezeWorkspace(owner: Db): Promise<void> {
  await owner.tx(async (tx) => void (await tx.query('UPDATE workspace SET read_only = false')));
}

async function bundleOf(p: PlatformDeps, handle: WorkspaceHandle, owner: Db): Promise<Bundle> {
  const members = await p.control.membersOf(handle.row.id);
  return exportWorkspace(owner, handle.cipher!, {
    exportedAt: p.now(),
    members,
    today: localNow(p.now(), handle.info.timeZone).date,
  });
}

// --- talking to another instance ---------------------------------------------

export interface PushPayload {
  slug: string;
  bundle: Bundle;
  dryRun: boolean;
}

export interface PushReply {
  /** The other side answered with a definite yes or no. False when the network failed or it answered 5xx. */
  definite: boolean;
  ok: boolean;
  problems: string[];
  digest: string | null;
  url: string | null;
}

const clean = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [v])
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.slice(0, 300))
    .slice(0, 10);

export async function push(
  p: PlatformDeps,
  target: Extract<MoveTarget, { kind: 'instance' }>,
  payload: PushPayload,
): Promise<PushReply> {
  let res: Response;
  try {
    res = await p.fetch(`${new URL(target.url).origin}/_migrate/receive`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${target.token}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return {
      definite: false,
      ok: false,
      problems: ['Could not reach that address.'],
      digest: null,
      url: null,
    };
  }
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse((await res.text()).slice(0, 2_000_000)) as Record<string, unknown>;
  } catch {
    // not JSON: handled as a refusal below
  }
  const definite = res.status < 500;
  const ok = res.ok && json.ok === true;
  const error = (json.error as { message?: unknown } | undefined)?.message;
  return {
    definite,
    ok,
    problems: ok
      ? []
      : clean(json.problems ?? error).length
        ? clean(json.problems ?? error)
        : res.status === 401
          ? ['That token was not accepted.']
          : res.status === 404
            ? ['That address is not an instance that accepts workspaces.']
            : [`The other side answered ${res.status}.`],
    digest: typeof json.digest === 'string' ? json.digest : null,
    url: typeof json.url === 'string' ? json.url : null,
  };
}

// --- looking before moving -----------------------------------------------------

const steps = (kind: MoveTarget['kind']): string[] =>
  kind === 'database'
    ? [
        'Your database is checked and prepared. Nothing of yours is touched.',
        'A trial copy is made and checked, then thrown away.',
        'Writing stops for a few seconds while the real copy is made. Reading carries on.',
        'Every statement is recalculated from the copy and compared with the original, to the paisa.',
        `If anything differs, nothing changes and writing resumes. If it all matches, you are switched over, and the old copy is removed after ${UNDO_DAYS} days, or sooner if you ask.`,
      ]
    : [
        'Your instance is asked whether it will take the workspace. Nothing is sent but the question.',
        'Writing stops for a few seconds while the workspace is sent.',
        'Your instance recalculates every statement and compares it with the original, to the paisa.',
        `If anything differs, nothing changes and writing resumes. If it all matches, this address points to your instance, and the copy here is removed after ${UNDO_DAYS} days, or sooner if you ask.`,
        'People sign in again at the new address with the same email; their roles come with them.',
      ];

/** Checks a target and the workspace without changing either. */
export async function previewMove(
  p: PlatformDeps,
  handle: WorkspaceHandle,
  target: MoveTarget,
): Promise<MovePreview> {
  const out: MovePreview = {
    ok: false,
    target: target.kind,
    problems: [],
    counts: {},
    digest: null,
    steps: steps(target.kind),
  };
  const bad = targetProblem(target.url, target.kind, p.config.production);
  if (bad) return { ...out, problems: [bad] };
  if (handle.row.state !== 'ACTIVE')
    return { ...out, problems: ['This workspace is already being moved or has moved.'] };

  if (target.kind === 'database') {
    out.problems.push(
      ...(await prepareExternalTarget(p.openDb, target.url, { checkOnly: true })).problems,
    );
  }
  const owner = p.openDb(handle.dsns.owner, { ephemeral: true });
  try {
    const bundle = await bundleOf(p, handle, owner);
    out.counts = bundle.manifest.counts;
    out.digest = bundle.manifest.digest;
    out.problems.push(...unsupportedRules(bundle));
    if (target.kind === 'instance') {
      const reply = await push(p, target, { slug: handle.row.slug, bundle, dryRun: true });
      if (!reply.ok) out.problems.push(...reply.problems);
    }
  } finally {
    await owner.close();
  }
  out.ok = out.problems.length === 0;
  return out;
}

// --- moving ----------------------------------------------------------------------

const refused = (r: ImportReport) =>
  new ApiError(
    422,
    'copy_differs',
    `The copy did not match the original, so nothing was changed. ${r.problems.slice(0, 3).join(' ')}`,
  );

/**
 * Moves the workspace into a Postgres database the tenant owns. The copy gets keys
 * of its own, so the old copy opens only with keys kept beside it, and those go
 * when it does. Either everything below happens or nothing does.
 */
export async function moveToDatabase(
  p: PlatformDeps,
  handle: WorkspaceHandle,
  _by: AccountRow,
  url: string,
): Promise<MoveResult> {
  const bad = targetProblem(url, 'database', p.config.production);
  if (bad) throw invalid(bad);
  const row = handle.row;
  if (!(await p.control.beginMove(row.id)))
    throw new ApiError(409, 'busy', 'This workspace is already being moved or has moved.');
  p.directory.invalidate(row.slug);

  const owner = p.openDb(handle.dsns.owner, { ephemeral: true });
  let target: TargetCheck | null = null;
  let targetDb: Db | null = null;
  let frozen = false;
  let switched = false;
  try {
    target = await prepareExternalTarget(p.openDb, url);
    if (!target.ok) throw new ApiError(422, 'target_unusable', target.problems.join(' '));
    targetDb = p.openDb(target.ownerUrl, { ephemeral: true });

    const wrapped = await newWorkspaceKeys(p.keyring, row.id);
    const newCipher = new FieldCipher(await loadWorkspaceKeys(p.keyring, row.id, wrapped));

    // A trial first, while writing is still open, so a copy that would fail does not stop anyone.
    const trial = await importBundle(targetDb, newCipher, await bundleOf(p, handle, owner), {
      dryRun: true,
    });
    if (!trial.ok) throw refused(trial);

    await freezeWorkspace(owner);
    frozen = true;
    const bundle = await bundleOf(p, handle, owner);
    const real = await importBundle(targetDb, newCipher, bundle, { dryRun: false });
    if (!real.ok || real.digest !== bundle.manifest.digest) throw refused(real);
    // The sign-in accounts stay on this instance; the copy has to know which person is which.
    const links = await p.control.membershipLinks(row.id);
    await targetDb.tx(async (tx) => {
      for (const l of links)
        await tx.query('SELECT bind_account($1, $2)', [l.personId, l.accountId]);
    });

    const removeBy = new Date(p.now().getTime() + UNDO_DAYS * DAY);
    await p.control.rehome(
      row.id,
      {
        placement: { kind: 'external', data: {} },
        dsnEnc: await sealDsns(p.keyring, row.id, { app: target.appUrl!, owner: target.ownerUrl }),
        ...wrapped,
      },
      {
        placement: row.placement,
        dsnEnc: row.dsnEnc,
        dataKeyWrapped: row.dataKeyWrapped!,
        logKeyWrapped: row.logKeyWrapped!,
      },
      removeBy,
    );
    switched = true;
    // Their own database has no storage caps of ours; the request budget stays, since we still serve it.
    const lifted: Limits = {
      ...(row.limits as Limits),
      people: UNLIMITED.people,
      rows: UNLIMITED.rows,
      bytes: UNLIMITED.bytes,
    };
    await p.control.setLimits(row.id, lifted).catch(() => undefined);
    p.directory.invalidate(row.slug);
    await p.control
      .event('workspace.moved', row.id, { to: 'database', digest: bundle.manifest.digest })
      .catch(() => undefined);
    return {
      target: 'database',
      digest: bundle.manifest.digest,
      counts: bundle.manifest.counts,
      movedTo: null,
      oldCopyRemovedBy: removeBy.toISOString(),
    };
  } catch (e) {
    if (!switched) {
      if (frozen) await unfreezeWorkspace(owner).catch(() => undefined);
      if (target?.touched)
        await new ExternalPlacement(p.openDb)
          .destroy(
            { kind: 'external', data: {} },
            { ownerUrl: target.ownerUrl, appUrl: target.appUrl ?? target.ownerUrl },
          )
          .catch(() => undefined);
      await p.control.setState(row.id, 'ACTIVE');
      p.directory.invalidate(row.slug);
    }
    throw e;
  } finally {
    await targetDb?.close().catch(() => undefined);
    await owner.close().catch(() => undefined);
  }
}

/**
 * Sends the workspace to the tenant's own instance. This copy stays, read-only and
 * pointing at the new address, until it is removed.
 */
export async function moveToInstance(
  p: PlatformDeps,
  handle: WorkspaceHandle,
  _by: AccountRow,
  target: Extract<MoveTarget, { kind: 'instance' }>,
): Promise<MoveResult> {
  const bad = targetProblem(target.url, 'instance', p.config.production);
  if (bad) throw invalid(bad);
  const row = handle.row;
  if (!(await p.control.beginMove(row.id)))
    throw new ApiError(409, 'busy', 'This workspace is already being moved or has moved.');
  p.directory.invalidate(row.slug);

  const owner = p.openDb(handle.dsns.owner, { ephemeral: true });
  let frozen = false;
  let outcome: 'none' | 'unsure' | 'done' = 'none';
  try {
    const trial = await push(p, target, {
      slug: row.slug,
      bundle: await bundleOf(p, handle, owner),
      dryRun: true,
    });
    if (!trial.ok)
      throw new ApiError(
        422,
        'target_refused',
        trial.problems.join(' ') || 'That instance would not take the workspace.',
      );

    await p.control.setMoveTarget(row.id, target.url);
    await freezeWorkspace(owner);
    frozen = true;
    const bundle = await bundleOf(p, handle, owner);
    outcome = 'unsure'; // from here until an answer arrives, the other side may or may not have it
    const reply = await push(p, target, { slug: row.slug, bundle, dryRun: false });
    if (reply.definite && !reply.ok) {
      outcome = 'none';
      throw new ApiError(
        422,
        'target_refused',
        `Nothing was changed. ${reply.problems.join(' ')}`.trim(),
      );
    }
    if (!reply.ok || reply.digest !== bundle.manifest.digest) {
      await p.control.event('workspace.move_unconfirmed', row.id, {}).catch(() => undefined);
      throw new ApiError(
        502,
        'move_unconfirmed',
        'We could not confirm the other instance has the workspace. It is read-only here until an operator has checked, and nothing is lost.',
      );
    }
    outcome = 'done';
    const movedTo = reply.url ?? `${new URL(target.url).origin}/w/${row.slug}`;
    await p.control.setMoved(row.id, movedTo);
    p.directory.invalidate(row.slug);
    await p.control
      .event('workspace.moved', row.id, { to: 'instance', digest: bundle.manifest.digest })
      .catch(() => undefined);
    return {
      target: 'instance',
      digest: bundle.manifest.digest,
      counts: bundle.manifest.counts,
      movedTo,
      oldCopyRemovedBy: new Date(p.now().getTime() + UNDO_DAYS * DAY).toISOString(),
    };
  } catch (e) {
    if (outcome === 'none') {
      if (frozen) await unfreezeWorkspace(owner).catch(() => undefined);
      await p.control.setMoveTarget(row.id, null).catch(() => undefined);
      await p.control.setState(row.id, 'ACTIVE');
      p.directory.invalidate(row.slug);
    }
    throw e;
  } finally {
    await owner.close().catch(() => undefined);
  }
}

/** Puts a workspace back to work after a move that stopped part-way. Only for a move that sent nothing. */
export async function releaseMove(p: PlatformDeps, workspaceId: string): Promise<void> {
  const row = await p.control.workspaceById(workspaceId);
  if (!row || row.state !== 'MIGRATING') return;
  const dsns = await readDsns(p.keyring, row.id, row.dsnEnc);
  const owner = p.openDb(dsns.owner, { ephemeral: true });
  try {
    await unfreezeWorkspace(owner);
  } finally {
    await owner.close();
  }
  await p.control.setMoveTarget(row.id, null);
  await p.control.setState(row.id, 'ACTIVE');
  p.directory.invalidate(row.slug);
}
