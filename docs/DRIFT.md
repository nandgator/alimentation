# Drift testing: do the tests notice when a guard goes missing?

A test that passes proves little if it would also pass with the thing it checks removed. Two kinds of drift
testing here ask that question.

## The engine: mutation testing

`npx stryker run` changes the billing engine, the rules, the validators and the money and date helpers one small
step at a time (a `<` made `<=`, a `+` made `-`, a branch removed) and runs the tests. A change nothing notices
is a rule nobody is checking. The report goes to `reports/mutation/core.json`; surviving changes that are
equivalent (the program behaves the same) carry a `// Stryker disable` comment that says why. At the last run the
engine's mutation score was 99.8 percent (1,264 of 1,266 changes caught). It is not part of CI (it takes several minutes); run it after changing the engine.

## The database: guards removed on purpose

`npm run drift:db` (`scripts/drift-db.mjs`) takes each database guard in turn (a row-level-security policy, a
privilege, an append-only trigger, a cap, a read-only guard, a rule that a person may log only one leave a day),
removes or loosens it in a freshly made workspace database, and runs the database tests. For each defect it
names the test that must fail. The run fails if:

- **MISSED**: nothing failed, so nothing was checking that guard;
- **caught by the wrong test**: something failed, but not the test written for that guard;
- the **control** (a change that breaks nothing) makes anything fail, which would mean the harness itself is broken.

Last run: 69 defects, 0 missed, 68 caught by their own test, and the control behaved. The same tests are
what stand behind promise VII (one person's rows are invisible to everyone else) and the immutability of claims,
decisions and the audit trail.

### Adding a guard

Add the guard to the migration, write the test, then add a line to `defects` in `scripts/drift-db.mjs`: a name, whether
to apply it as the owner or the administrator, the SQL that undoes the guard, and a fragment of the test's name. Run
`npm run drift:db <part of the name>` and see it caught.

### What this does not cover

The lifecycle code (moving, wiping, receiving, re-wrapping keys) is not database guards but program logic, and is
checked by tests that break things in flight instead: a copy that fails half-way, a host that does not answer, a
wipe that stops after the keys are gone, a restore that brings the keys back. They are in
`apps/api/test/lifecycle.*.test.ts` and `rewrap.test.ts`.
