# Handoff

Where things stand, what is proven, what is not, and what to do next. Written for whoever picks this
up, including its owner in six months.

## What exists

| Part                             | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Billing engine (`packages/core`) | Done. Every rule in `docs/SPEC.md`, per-workspace rules as typed documents, reference cases, mutation score 99.8 percent.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Database (`apps/api/migrations`) | Done. One database per workspace; row-level security forced for the application role; append-only tables; caps; read-only freeze; personal fields encrypted before they are stored.                                                                                                                                                                                                                                                                                                                                                                             |
| API (`apps/api`)                 | Done. Sign-in (OpenID Connect), invitations, workspace creation, every screen's endpoints, admission control, usage meter, security headers.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Leaving                          | Done. Export; move to a database of your own or to your own instance, verified to the paisa; wipe with keys destroyed first, receipt, resumable; housekeeping; master-key rotation.                                                                                                                                                                                                                                                                                                                                                                             |
| Placements                       | `pg-database` and `external`: done and tested on real Postgres. `neon-project`: written against Neon's published API and tested against a stand-in only.                                                                                                                                                                                                                                                                                                                                                                                                        |
| Web app (`apps/web`)             | Done. Home page, role screens, offline reading, installable. Tested in a real browser on desktop and phone, with accessibility checks.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Trust and transparency           | Done. Late entries are marked, never refused unless a kitchen sets a cut-off; members and the supplier read, in words, what was done to their own records (**History**).                                                                                                                                                                                                                                                                                                                                                                                        |
| Menu and layout                  | Done. One list of screens drives the menu, routes and role guards; a grouped sidebar that can be hidden; a bottom bar tested at four phone widths.                                                                                                                                                                                                                                                                                                                                                                                                              |
| Design system                    | Done. Tokens in `styles.css`, documented at `/docs/design/`, enforced by `bun run design`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Documentation                    | Done. Two hosted sites built from `docs/site`: `/guides` for people, `/docs` for technicians, each opening on a short front page. No framework (see `docs/DESIGN.md` section 12).                                                                                                                                                                                                                                                                                                                                                                               |
| API reference (`apps/reference`) | Done. Its own site, apart from the docs and the app: every route is listed once in `apps/api/src/openapi.ts` with the schema the route itself parses (`schemas.ts`), built with Scalar, served read only. A test fails if a route or an error code is missing; it is its own image (`--profile reference`), its own Cloudflare assets deploy and its own CI job.                                                                                                                                                                                                |
| Sign-in on a machine             | Done for Authelia with LLDAP: `dev/idp/idp.sh up\|test\|down\|reset authelia`, run and tested in a real browser. Other providers are written up, not run (`/docs/self-hosting/sign-in-locally/`). The OpenID client asks userinfo for an email the identity token leaves out, takes the secret in a Basic header when that is the only way offered, and one email is one account across providers. Google, Microsoft, Apple and Meta were compared before and after: Google identical; the others were refused before and still are, for reasons written there. |
| Code and diagrams in the docs    | Done. Highlighted code (classes, never inline style), ghost line numbers, `file=path#L1-L9` excerpts that fail the build when the lines are gone, and ```mermaid fences drawn at build time into SVG coloured from the design system's tokens (`apps/web/scripts/docs-blocks.mjs`).                                                                                                                                                                                                                                                                             |
| Several kitchens                 | Done. A person in two or more kitchens sees each with its figures and a line across them; can copy prices, rules and holidays between kitchens they run, after seeing what would be added; and a head office (an organisation) sees each sharing kitchen's totals for the month and no name. A one-kitchen user is asked for nothing and shown none of it. See `docs/DESIGN.md` 5.12.                                                                                                                                                                           |
| Microsoft sign-in                | Opt-in and **not tried against a real tenant**: `OIDC_EMAIL_VERIFIED_CLAIM=xms_edov` with one tenant's address as the issuer. Tested against Microsoft's published discovery document and a stand-in that sends what its reference says. Apple is not supported (it needs the paid Apple Developer Program and a different client secret). The costs of every way to sign in are in `/docs/self-hosting/choosing-sign-in/`.                                                                                                                                     |
| Behind a proxy                   | `compose.proxy.yaml` puts Caddy in front of the app and the API reference at one address. **Caddy and the Compose file were not run here** (Docker Hub rate-limited the pull and a binary download was not allowed); the reference was run behind a stand-in proxy that strips the prefix, with no errors. Nginx, HAProxy and Traefik settings are written from their documentation.                                                                                                                                                                            |
| AI agents                        | Done, as decided (`docs/DESIGN.md` 5.13): a key a person gives an agent (read, log, claims; five at once; ninety days by default), held to a single table of what a key may call, marked in the kitchen's own record (`audit_log.via`, shown in History, carried by a move), an MCP server at `/mcp` made from the same table, `/llms.txt` and `/llms-full.txt` built with the docs, and a card under **Your data**. Tested through the API, in a browser, and with the official MCP client library against a local instance; not with a hosted assistant.      |
| People by file                   | Done, as decided (`docs/DESIGN.md` 5.14): an optional plain-text key on a person (unique, set once; migration 0004) and `POST /people/import` (JSON or `text/csv`; merge or overwrite; dry run; all or nothing; checked against the people cap first; one `person_import` audit line). Import and Export CSV on the People screen. Admin only, not open to agent keys. Tested on Postgres and in a browser (`e2e/people-import.spec.ts`).                                                                                                                       |
| Theme                            | Done. One choice (Auto, Light, Dark) for the app, the home page and both sites, applied before the first paint by `public/theme.js`.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| On a machine                     | `dev/local.sh up\|dev\|down\|reset` runs the app on the machine with only Postgres in a container (Docker or Podman, chosen by `scripts/containers.sh`) and serves the API reference at `/reference/` as the proxy does.                                                                                                                                                                                                                                                                                                                                        |
| Runtime                          | Node 24 or later (`engines`, `.nvmrc`, the image and CI). Statements on one transaction queue in `db/driver.ts`, so nothing depends on `pg` queueing them behind its back.                                                                                                                                                                                                                                                                                                                                                                                      |
| Deployment                       | Cloudflare Worker (`apps/api/wrangler.jsonc`), one container image, Compose files for a dedicated instance and for the tests, CI.                                                                                                                                                                                                                                                                                                                                                                                                                               |

## How to know it still works

```sh
bun run check                                          # format, markdown, lint and types, without a database
docker compose -f compose.test.yaml run --rm test      # the same, plus promises, design, every test on Postgres 18 (Podman works too: CONTAINER_ENGINE)
bun run test:e2e                                       # the app and both documentation sites, in a real browser, desktop and phone
bun run drift:db                                       # database guards removed in turn (78 at the last run, all noticed by their own test); each must be noticed
bun run smoke:compose && bun run smoke:worker          # the image, and the Worker in the Workers runtime
```

CI (`.github/workflows/ci.yml`) runs the first, the e2e, both smokes. The home page's promises are
kept honest by `bun run promises`: a promise with no test tagged `[P<n>]`, or a page that disagrees
with `docs/PROMISES.md`, fails the build.

## Not proven here

These need accounts, keys or real traffic that the build did not have. Each has a place in
`docs/RUNBOOK.md`.

1. **Neon's terms for an operator running other organisations' kitchens on Free-plan projects.** Ask
   Neon or read the terms before launch. If the answer is no, the same code runs on any Postgres.
2. **How Neon's real API answers.** `bun run smoke:live` makes a kitchen on a real project and
   removes it. One field is unconfirmed: `history_retention_seconds: 0`.
3. **Whether a Worker request fits in 10 ms of CPU on the free plan.** It works in the Workers
   runtime; the figure that matters is only known on the real platform. `smoke:live` prints timings.
4. **Automated hand-over through Neon's claim links.** Not built: it is a private preview. A tenant
   moves with a connection string.
5. **Cost and limit numbers** in `docs/DESIGN.md` carry their source. Those marked secondary were
   not read on the vendor's own page.
6. **A browser other than Chromium, beyond the newest parts.** The suites run on Chromium (desktop
   and a phone profile). The docs and the several-kitchens screens also run in Firefox and in
   WebKit, Safari's engine, on a desktop (`bunx playwright install firefox webkit`, then
   `bun run --filter @alimentation/web test:browsers`): 46 passed and 4 skipped, the skips being
   what a browser cannot do (Firefox draws no page that moves with the scroll and glides into no
   next page; the phone test is for a phone). Not run in either: the rest of the suite, the home
   page's motion, and a real phone. WebKit logs a refused stylesheet for any `select` under a policy
   that allows no inline style; it is WebKit's own, a page with nothing but a select does it, and
   the select works, so `watchPage` leaves that one message out for WebKit only. The home page
   relies on container-query units, `color-mix`, `overflow: clip` and the separate `translate` and
   `rotate` properties, which every browser has had since 2023; older ones are not supported.
7. **The reference image and the proxy.** The reference image was built from the real Dockerfile
   (the one change was to make the sandbox proxy's certificate known to the package install, as the
   sandbox asks), run, and opened in a browser: 257 MB, runs as `node`, answers `/healthz`, refuses
   a POST, loads Scalar with nothing refused. Caddy and `compose.proxy.yaml` were not run: Docker
   Hub was rate-limiting pulls, and fetching the binary another way was not allowed. What was run is
   the reference behind a stand-in proxy that strips `/reference` and redirects the bare path, in a
   browser, with nothing refused.

## Decisions worth knowing

- **One database per workspace** is the whole isolation and erasure story; everything else follows
  from it.
- **The key is destroyed first when wiping**, so what an interrupted wipe leaves is unreadable. A
  restore of the control database can bring keys back, so housekeeping wipes again anything that has
  a receipt.
- **A move never leaves two live copies.** If the other side may have accepted and the answer was
  lost, the kitchen stays read-only and waits for a person.
- **Only the supplier decides a payment; only the admin reverses one.** The screens follow the rules
  in `packages/core`.
- **Free-tier numbers are configuration** (`FREE_LIMITS_JSON`, `CAPACITY_JSON`; 100 people and
  20,000 entries a kitchen by default). A kitchen keeps the limits it was created with, and capacity
  is worked out from the compiled defaults, so set `perWorkspaceRequestsPerDay` in `CAPACITY_JSON`
  too if requests per day change. When a host changes its terms, change those.
- **A strict content-security policy** (nothing from anywhere but the site itself) is sent
  everywhere; `apps/web/public/_headers` repeats it for Cloudflare's static files and a test keeps
  the two equal.
- **The Worker's database traffic is one WebSocket connection per transaction.** It is the first
  thing to measure.
- **The home page is a kitchen, drawn in code.** Tiled green walls, steel, turmeric and a chalkboard
  (`apps/web/src/home.css`, `apps/web/src/home/art.tsx`); Young Serif for headings and Figtree for
  text, both served by the site itself so the content-security policy stays strict. There are no
  photographs, so there are no licences or credits to keep. The month a visitor can try is a live
  calendar on the visitor's own date, run by the real billing engine on a made-up person
  (`apps/web/src/home/month.ts`, pinned by a test): days up to today are frozen, days after it are
  tentative and can be changed, and the bill shows what is frozen so far and what is expected. Words
  are plain on purpose; the technical detail sits in one section at the bottom. Each promise's title
  on the page is the ledger's wording, and `bun run promises` fails if they drift.
- **One idea of depth on the home page.** Whatever hangs on the wall or lies against it throws a
  shadow (the chalkboard, the picture of the kitchen, the step in view, the receipt, the shelves);
  flat things (buttons, day tiles, text) do not. It is two tokens in `home.css`, `--lift` and
  `--lift-cut`, deeper in dark mode, and a browser test keeps them equal.
- **The home page is one motion, and none of it hides anything.** Parts below the first screen
  arrive by how far up the screen they are, through CSS scroll-linked animation
  (`animation-timeline: view()`), so a fast scroll cannot leave one a beat behind; where a browser
  cannot, the same arrivals are timed once, by the observer in `useReveal`, and the class that hides
  them is added only after it is running and never under reduced motion. A browser test scrolls the
  whole page and fails if anything is left waiting. The carrier's place on the Moving stage is one
  number (`smoothDamp` in `home/motion.tsx`) that every frame draws from, never a timed hop that is
  cancelled and restarted; a browser test scrolls the page hard back and forth and fails if the
  carrier ever moves faster than a hop does (it fails on the old stage, at 13,000 px/s). The steam
  is drawn in `home/steam.tsx`: bold lines from behind the lids, thinned by a mask, the wisps of one
  lid on one pace and started at spread points of it (on paces of their own they drift into step and
  the lid goes quiet, then puffs). The first screen's carrier is lifted off its shelf, carried to
  the first chapter's heading, put into the bar as that heading goes up and taken out again for the
  next, chapter by chapter (`home/Dock.tsx`, the arithmetic in `home/dock.ts`): a copy of it, placed
  from the scroll alone while the page moves, that is the bar's tiffin while it is in the bar; the
  tiffin is packed by the scroll, and the guides and docs share the packing. Its place is one number
  along a line of rests (shelf, heading, bar, heading, bar, ...; `journeyAt`), and it is never left
  between two: after `STILL` ms with no scroll, `carried` (a spring) brings it to the nearest rest,
  and it follows the page again, without a pull, when the page moves. The bar's mark is a ghost from
  the first screen on. The number is on the flyer as `data-at`, which the browser tests read. The
  footer's light (`useLight`) ignores the pointer events a theme dissolve swallows, so it stays
  under the hand while the page changes. A heading the page holds in place (the Moving stage's) is
  stood on where it is met, in the page's flow. A change of theme, from any page, dissolves
  (`fadeTheme` in `public/theme.js`, `--dur-4`) and is instant under reduced motion. See principle 5
  in the design docs.
- **The docs open one part of the contents at a time.** The contents is a `details` for each part
  with only the part being read open, long paths in code may break after a slash, and the pages hand
  over to one another with a view transition where the browser has them. How roomy a page reads is
  the design system's, not the docs stylesheet's: `--measure`, `--leading`, `--leading-lede` and
  `--flow` in `styles.css`, set out under Foundations, Reading.

- **Trust is tamper-evident, not tamper-proof.** Every record carries who and when, stamped by the
  database; the people a change affects can read it; a catch-up is allowed until the month closes
  and is marked late. One person holding two roles, collusion and the instance's operator are
  deliberately out of scope (`docs/site/docs/concepts/trust-model.md`).
- **The design system is enforced, not advised.** `scripts/check-design.mjs` fails the build on a
  raw colour, shadow, layer, font, size, off-grid gap (a `rem` counts as the pixels it comes to),
  radius, duration, breakpoint, or an inline style that decides a look. A waiver is a comment that
  begins `design:` with a reason.
- **Two documentation sites, one generator, no framework.** The content-security policy forbids the
  inline script and style that documentation frameworks emit. The build and its tests are in
  `apps/web/scripts/build-docs.mjs`, `apps/web/src/docs.test.ts` and `apps/web/e2e/docs.spec.ts`.

## What to do next

1. Decide the questions only the owner can: a licence (none is chosen), whether to publish, the
   domain name.
2. Do `docs/RUNBOOK.md` section A, ending with `smoke:live`, and read the timings.
3. Create the first two kitchens from `/app`. Each has its own rate cards, rules and people; nothing
   is shared between kitchens unless someone copies it. Invite everyone. The seed figures and
   reference cases from `docs/SPEC.md` section 10 and 11 are in `packages/core/test`.
4. Run the month-close rules past each kitchen: they are per-kitchen settings under **Rates and
   rules**.
5. Put the browser tests on a Safari and a Firefox profile if members use them.

## Where things are

```text
packages/core/src      engine.ts (statements), policy.ts (per-kitchen rules), validate.ts, limits.ts, bundle.ts
apps/api/migrations    workspace/ and control/ SQL; src/db/migrations.generated.ts is built from them (bun run build:server does it)
apps/api/src           app.ts (routes), workspace/ (service), lifecycle/ (move, receive, wipe, rewrap, housekeeping),
                       placement/ (pg-database, neon, external), limits/ (gate), crypto/, worker.ts, node.ts, cli.ts
apps/web/src           pages/Home.tsx, pages/workspace/* (sections.ts lists the screens), sw.ts (offline), styles.css (the tokens)
apps/web/scripts       build-docs.mjs and docs/ (the generator, stylesheet and scripts of the two documentation sites)
docs/site              guides/ (for people) and docs/ (for technicians), each with a nav.json
dev                    local.sh (run on a machine), front.mjs, idp/ (sign-in providers)
scripts                containers.sh, drift-db.mjs, check-promises.mjs, check-design.mjs, smoke-*.sh, smoke-live.mts
```
