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
| Trust and transparency           | Done. Late entries are marked, never refused unless a kitchen sets a cut-off; members and the supplier read, in words, what was done to their own records (**History**).            |
| Menu and layout                  | Done. One list of screens drives the menu, routes and role guards; a grouped sidebar that can be hidden; a bottom bar tested at four phone widths.                                  |
| Design system                    | Done. Tokens in `styles.css`, documented at `/docs/design/`, enforced by `npm run design`.                                                                                          |
| Documentation                    | Done. Two hosted sites built from `docs/site`: `/guides` for people, `/docs` for technicians, each opening on a short front page. No framework (see `docs/DESIGN.md` section 12).   |
| Colours                          | Done. One choice (Auto, Light, Dark) for the app, the home page and both sites, applied before the first paint by `public/theme.js`.                                                |
| Runtime                          | Node 24 or later (`engines`, `.nvmrc`, the image and CI). Statements on one transaction queue in `db/driver.ts`, so nothing depends on `pg` queueing them behind its back.          |
| Deployment                       | Cloudflare Worker (`apps/api/wrangler.jsonc`), one container image, Compose files for a dedicated instance and for the tests, CI.                                                   |

## How to know it still works

```sh
docker compose -f compose.test.yaml run --rm test      # format, types, promises, design, every test on Postgres 18
npm run test:e2e                                       # the app and both documentation sites, in a real browser, desktop and phone
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
  policy stays strict. There are no photographs, so there are no licences or credits to keep. The month a visitor can try is a live
  calendar on the visitor's own date, run by the real billing engine on a made-up person (`apps/web/src/home/month.ts`, pinned by a test): days up to today are frozen, days after it are tentative and can be
  changed, and the bill shows what is frozen so far and what is expected. Words are plain on purpose; the technical
  detail sits in one section at the bottom. Each promise's title on the page is the ledger's wording, and `npm run promises` fails if
  they drift.
- **One idea of depth on the home page.** Whatever hangs on the wall or lies against it throws a shadow (the chalkboard, the
  picture of the kitchen, the step in view, the receipt, the shelves); flat things (buttons, day tiles, text) do not. It is two
  tokens in `home.css`, `--lift` and `--lift-cut`, deeper in dark mode, and a browser test keeps them equal.
- **The home page is one motion, and none of it hides anything.** Parts below the first screen arrive by how far up the screen
  they are, through CSS scroll-linked animation (`animation-timeline: view()`), so a fast scroll cannot leave one a beat behind;
  where a browser cannot, the same arrivals are timed once, by the observer in `useReveal`, and the class that hides them is
  added only after it is running and never under reduced motion. A browser test scrolls the whole page and fails if anything is
  left waiting. The carrier's place on the Moving stage is one number (`smoothDamp` in `home/motion.tsx`) that every frame draws
  from, never a timed hop that is cancelled and restarted; a browser test scrolls the page hard back and forth and fails if the
  carrier ever moves faster than a hop does (it fails on the old stage, at 13,000 px/s). The steam is drawn in `home/steam.tsx`:
  bold lines from behind the lids, thinned by a mask, the wisps of one lid on one pace and started at spread points of it (on
  paces of their own they drift into step and the lid goes quiet, then puffs). The first screen's carrier is lifted off its shelf, carried to the first chapter's heading, put into the bar as that heading
  goes up and taken out again for the next, chapter by chapter (`home/Dock.tsx`, the arithmetic in `home/dock.ts`): a copy of it,
  placed from the scroll alone, that is the bar's tiffin while it is in the bar; the tiffin is packed by the scroll, and the
  guides and docs share the packing. A heading the page holds in place (the Moving stage's) is stood on where it is met, in the
  page's flow. A change of theme, from any page, dissolves (`fadeTheme` in `public/theme.js`, `--dur-4`) and is
  instant under reduced motion. See principle 5 in the design docs.
- **The docs open one part of the contents at a time.** The contents is a `details` for each part with only the part being
  read open, long paths in code may break after a slash, and the pages hand over to one another with a view transition where the
  browser has them. How roomy a page reads is the design system's, not the docs stylesheet's: `--measure`, `--leading`,
  `--leading-lede` and `--flow` in `styles.css`, set out under Foundations, Reading.

- **Trust is tamper-evident, not tamper-proof.** Every record carries who and when, stamped by the database; the people a
  change affects can read it; a catch-up is allowed until the month closes and is marked late. One person holding two roles,
  collusion and the instance's operator are deliberately out of scope (`docs/site/docs/concepts/trust-model.md`).
- **The design system is enforced, not advised.** `scripts/check-design.mjs` fails the build on a raw colour, shadow, layer,
  font, size, off-grid gap (a `rem` counts as the pixels it comes to), radius, duration, breakpoint, or an inline style that
  decides a look. A waiver is a comment that begins `design:` with a reason.
- **Two documentation sites, one generator, no framework.** The content-security policy forbids the inline script and style
  that documentation frameworks emit. The build and its tests are in `apps/web/scripts/build-docs.mjs`,
  `apps/web/src/docs.test.ts` and `apps/web/e2e/docs.spec.ts`.

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
apps/web/src           pages/Home.tsx, pages/workspace/* (sections.ts lists the screens), sw.ts (offline), styles.css (the tokens)
apps/web/scripts       build-docs.mjs and docs/ (the generator, stylesheet and scripts of the two documentation sites)
docs/site              guides/ (for people) and docs/ (for technicians), each with a nav.json
scripts                drift-db.mjs, check-promises.mjs, check-design.mjs, smoke-*.sh, smoke-live.mts
```
