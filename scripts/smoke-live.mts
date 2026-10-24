// Proves a real deployment works, end to end, and leaves nothing behind.
//
//   APP_URL=https://alimentation.example.workers.dev \
//   SESSION_SECRETS=... CONTROL_DATABASE_URL=... \
//   NEON_API_KEY=...            (optional: also checks Neon agrees the project is gone) \
//   npx tsx scripts/smoke-live.mts
//
// It makes its own test account in the control database and signs a short session for it, so no
// login is needed; makes a kitchen (on a real Neon project, when that is how the deployment
// places them); sets it up, reads it back, takes a copy; then deletes it and checks the
// receipt. Times are printed, because the figures that matter (how long a request takes through
// a Worker to Neon) can only be measured on the real thing.
import { TokenSigner } from '../apps/api/src/auth/session.ts';
import { ControlRepo } from '../apps/api/src/control/repo.ts';
import { nodeDb } from '../apps/api/src/db/node.ts';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required (see the top of this file)`);
  return v;
};
const base = need('APP_URL').replace(/\/+$/, '');
const origin = new URL(base).origin;
const secure = origin.startsWith('https://');
const stamp = Date.now().toString(36);
const slug = `smoke-${stamp}`;
const email = `smoke-${stamp}@example.invalid`;

const timings: Record<string, number[]> = {};
const timed = async <T,>(name: string, fn: () => Promise<T>): Promise<T> => {
  const t = performance.now();
  try {
    return await fn();
  } finally {
    (timings[name] ??= []).push(Math.round(performance.now() - t));
  }
};

const db = nodeDb(need('CONTROL_DATABASE_URL'), { max: 1 });
const control = new ControlRepo(db);
const signer = await TokenSigner.fromSecrets(
  need('SESSION_SECRETS')
    .split(',')
    .map((s) => s.trim()),
);
const account = await control.upsertAccount({ issuer: 'smoke', sub: email, email, name: 'Smoke' });
const session = await signer.sign({ a: account.id, e: account.email, n: 'Smoke' }, 600, new Date());
const cookie = `${secure ? '__Host-session' : 'session'}=${session}`;

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(base + path, {
    method,
    headers: {
      cookie,
      origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}
const must = (r: { status: number; json: any }, want: number, what: string) => {
  if (r.status !== want)
    throw new Error(
      `${what}: expected ${want}, got ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`,
    );
  return r.json;
};

const steps: string[] = [];
const step = (s: string) => steps.push(s);
let made = false;
let placement: { kind: string; data: Record<string, string> } | null = null;
let failure: unknown = null;

try {
  must(await timed('health', () => call('GET', '/api/health')), 200, 'health');
  const cap = must(await call('GET', '/api/public/capacity'), 200, 'capacity');
  step(
    `reachable; ${cap.used} of ${cap.capacity} free places used${cap.dedicated ? ' (dedicated)' : ''}`,
  );

  must(
    await timed('create a kitchen', () =>
      call('POST', '/api/workspaces', { slug, name: 'Smoke test', alsoSupplier: true }),
    ),
    201,
    'create',
  );
  made = true;
  placement = (await control.workspaceBySlug(slug))!.placement as typeof placement;
  step(
    `created a kitchen on ${placement!.kind}${placement!.data.projectId ? ` (project ${placement!.data.projectId})` : ''}`,
  );

  const w = `/api/w/${slug}`;
  const first = new Date();
  const day = `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}-01`;
  must(
    await call('POST', `${w}/rate-cards`, {
      effectiveFrom: day,
      veg: 15000,
      nonVeg: 17000,
      extraChapati: 1500,
      extraBhakri: 3000,
      extrasPerMonth: 4000,
      menu: { 1: 'Veg', 2: 'Veg', 3: 'Non Veg', 4: 'Veg', 5: 'Non Veg' },
    }),
    201,
    'rate card',
  );
  must(
    await call('POST', `${w}/people`, { name: 'Smoke Eater', role: 'consumer', activeFrom: day }),
    201,
    'add a person',
  );
  for (let i = 0; i < 5; i++) {
    const boot = must(
      await timed('read the dashboard', () => call('GET', `${w}/bootstrap`)),
      200,
      'bootstrap',
    );
    if (i === 0 && !(boot.statements.length === 1 && boot.statements[0].billed > 0))
      throw new Error('the statement did not come out');
  }
  step('set it up, read it back five times, and the bill came out');

  const copy = must(await timed('take a copy', () => call('GET', `${w}/export`)), 200, 'export');
  if (!/^[0-9a-f]{64}$/.test(copy.manifest.digest)) throw new Error('the copy has no checksum');
  step(`took a copy, checksum ${copy.manifest.digest.slice(0, 12)}…`);

  const wiped = must(
    await timed('delete it', () => call('POST', `${w}/wipe`, { confirm: slug })),
    200,
    'wipe',
  );
  made = false;
  if (!wiped.done) throw new Error(`the delete did not finish: ${JSON.stringify(wiped)}`);
  const checks = wiped.receipt.manifest.checks as Record<string, boolean>;
  if (!Object.values(checks).every(Boolean))
    throw new Error(`the receipt reports a failed check: ${JSON.stringify(checks)}`);
  must(await call('GET', `/api/receipts/${wiped.receipt.workspaceId}`), 200, 'receipt');
  step('deleted it; every check on the receipt passed');
  if ((await control.workspaceBySlug(slug)) !== undefined)
    throw new Error('the kitchen is still listed after the delete');

  if (placement?.kind === 'neon-project' && process.env.NEON_API_KEY) {
    const res = await fetch(
      `https://console.neon.tech/api/v2/projects/${placement.data.projectId}`,
      {
        headers: {
          authorization: `Bearer ${process.env.NEON_API_KEY}`,
          accept: 'application/json',
        },
      },
    );
    if (res.status !== 404) throw new Error(`Neon still has the project (status ${res.status})`);
    step('Neon confirms the project is gone');
  } else if (placement?.kind === 'neon-project') {
    step('(set NEON_API_KEY to also check that Neon agrees the project is gone)');
  }
} catch (e) {
  failure = e;
  if (made) {
    // Do not leave a kitchen, or a Neon project counted against the free allowance, behind.
    await call('POST', `/api/w/${slug}/wipe`, { confirm: slug }).catch(() => undefined);
  }
} finally {
  await db.close().catch(() => undefined);
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
console.log(steps.map((s) => `  ✓ ${s}`).join('\n'));
console.log('\nTimes in milliseconds (this machine to the deployment and back):');
for (const [name, xs] of Object.entries(timings))
  console.log(
    `  ${name.padEnd(20)} median ${String(median(xs)).padStart(6)}   slowest ${String(Math.max(...xs)).padStart(6)}   (${xs.length} call${xs.length === 1 ? '' : 's'})`,
  );
if (failure) {
  console.error(`\n✗ ${(failure as Error).message}`);
  process.exit(1);
}
console.log('\nOK');
