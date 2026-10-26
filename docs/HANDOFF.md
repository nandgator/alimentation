# Handoff

Where things stand, what is proven, what is not, and what to do next. Written for whoever picks this up,
including its owner in six months.

## What exists

| Part                             | State                                                                                                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Billing engine (`packages/core`) | Done. Every rule in `docs/SPEC.md`, per-workspace rules as typed documents, reference cases, mutation score 99.8 percent.                                                           |
| Database (`apps/api/migrations`) | Done. One database per workspace; row-level security forced for the application role; append-only tables; caps; read-only freeze; personal fields encrypted before they are stored. |
| API (`apps/api`)                 | Done. Sign-in (OpenID Connect), invitations, workspace creation, every screen's endpoints, admission control, usage meter, security headers.                                        |
| Leaving                          | Done. Export; move to a database of your own or to your own instance, verified to the paisa; wipe with keys destroyed first, receipt, resumable; housekeeping; master-key rotation. |
| Placements                       | `pg-database` and `external`: done and tested on real Postgres. `neon-project`: written against Neon's published API and tested against a stand-in only.                            |
| Web app (`apps/web`)             | Done. Home page, role screens, offline reading, installable. Tested in a real browser on desktop and phone, with accessibility checks.                                              |
| Deployment                       | Cloudflare Worker (`apps/api/wrangler.jsonc`), one container image, Compose files for a dedicated instance and for the tests, CI.                                                   |

## How to know it still works

```sh
docker compose -f compose.test.yaml run --rm test      # format, types, promises, ~400 tests on Postgres 18
npm run test:e2e                                       # 20 browser checks
npm run drift:db                                       # 69 database guards removed in turn; each must be noticed
npm run smoke:compose && npm run smoke:worker          # the image, and the Worker in the Workers runtime
```

CI (`.github/workflows/ci.yml`) runs the first, the e2e, both smokes. The home page's promises are kept honest by
`npm run promises`: a promise with no test tagged `[P<n>]`, or a page that disagrees with `docs/PROMISES.md`, fails the build.

## Not proven here

These need accounts, keys or real traffic that the build did not have. Each has a place in `docs/RUNBOOK.md`.

1. **Neon's terms for an operator running other organisations' kitchens on Free-plan projects.** Ask Neon or read the terms
   before launch. If the answer is no, the same code runs on any Postgres.
2. **How Neon's real API answers.** `npm run smoke:live` makes a kitchen on a real project and removes it. One field is
   unconfirmed: `history_retention_seconds: 0`.
3. **Whether a Worker request fits in 10 ms of CPU on the free plan.** It works in the Workers runtime; the figure that matters is
   only known on the real platform. `smoke:live` prints timings.
4. **Automated hand-over through Neon's claim links.** Not built: it is a private preview. A tenant moves with a connection string.
5. **Cost and limit numbers** in `docs/DESIGN.md` carry their source. Those marked secondary were not read on the vendor's own page.
6. **A browser other than Chromium.** The suites run on Chromium (desktop and a phone profile). Safari and Firefox are not tested.
   The home page relies on container-query units, `color-mix`, `overflow: clip` and the separate `translate` and `rotate`
   properties, which every browser has had since 2023; older ones are not supported.

## Decisions worth knowing

- **One database per workspace** is the whole isolation and erasure story; everything else follows from it.
- **The key is destroyed first when wiping**, so what an interrupted wipe leaves is unreadable. A restore of the control database
  can bring keys back, so housekeeping wipes again anything that has a receipt.
- **A move never leaves two live copies.** If the other side may have accepted and the answer was lost, the kitchen stays read-only and
  waits for a person.
- **Only the supplier decides a payment; only the admin reverses one.** The screens follow the rules in `packages/core`.
- **Free-tier numbers are configuration** (`FREE_LIMITS_JSON`, `CAPACITY_JSON`). When a host changes its terms, change those.
- **A strict content-security policy** (nothing from anywhere but the site itself) is sent everywhere; `apps/web/public/_headers` repeats it
  for Cloudflare's static files and a test keeps the two equal.
- **The Worker's database traffic is one WebSocket connection per transaction.** It is the first thing to measure.
- **The home page is a kitchen, drawn in code.** Tiled green walls, steel, turmeric and a chalkboard (`apps/web/src/home.css`,
  `apps/web/src/home/art.tsx`); Young Serif for headings and Figtree for text, both served by the site itself so the content-security
  policy stays strict. There are no photographs, so there are no licences or credits to keep. The month a visitor can try runs the real
  billing engine on made-up people (`apps/web/src/home/month.ts`, pinned by a test). Words are plain on purpose; the technical
  detail sits in one section at the bottom. Each promise's title on the page is the ledger's wording, and `npm run promises` fails if
  they drift.
- **Motion on the home page is small and never hides anything.** Transform, opacity and clip-path only. Parts below the first
  screen arrive once, as they are reached; the class that hides them is added only after the observer is running, and never under
  reduced motion. A browser test scrolls the whole page and fails if anything is left waiting. The carrier's hop between the three
  places is a Web Animations call (a ride and a separate lift, so the top of the arc is smooth), not a scroll-linked effect, so it
  behaves the same in every browser.

## What to do next

1. Decide the questions only the owner can: a licence (none is chosen), whether to publish, the domain name.
2. Do `docs/RUNBOOK.md` section A, ending with `smoke:live`, and read the timings.
3. Create the first two kitchens (the YMCA mess, a home kitchen) from `/app`, add their rate cards and people, and invite everyone.
   The seed figures and reference cases from `docs/SPEC.md` section 10 and 11 are in `packages/core/test`.
4. Run the month-close rules past each kitchen: they are per-kitchen settings under **Rates and rules**.
5. Put the browser tests on a Safari and a Firefox profile if members use them.

## Where things are

```
packages/core/src      engine.ts (statements), policy.ts (per-kitchen rules), validate.ts, limits.ts, bundle.ts
apps/api/migrations    workspace/ and control/ SQL; src/db/migrations.generated.ts is built from them (npm run build:server does it)
apps/api/src           app.ts (routes), workspace/ (service), lifecycle/ (move, receive, wipe, rewrap, housekeeping),
                       placement/ (pg-database, neon, external), limits/ (gate), crypto/, worker.ts, node.ts, cli.ts
apps/web/src           pages/Home.tsx, pages/workspace/*, sw.ts (offline), styles.css
scripts                drift-db.mjs, check-promises.mjs, smoke-*.sh, smoke-live.mts
```
