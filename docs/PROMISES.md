# Promises ledger

Every claim on the home page is listed here with the test that proves it. A test
proves a promise by carrying the tag `[P<n>]` in its name. `scripts/check-promises.mjs`
fails the build when a promise has no tagged test, or a tag names no promise.

| ID  | Promise                                              | Proof (tagged tests)                                                                                                                   | Status |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| P1  | Nobody can crowd you out.                            | tagged in gate.test.ts, http.test.ts, neon.test.ts, service.test.ts, workspace.guards.test.ts                                          | tested |
| P2  | Free until you outgrow it, and we say so in advance. | tagged in http.test.ts, service.test.ts                                                                                                | tested |
| P3  | Outgrow it, move in one click, lose nothing.         | tagged in bundle.test.ts, lifecycle.move.test.ts, lifecycle.test.ts, lifecycle.wipe.test.ts, service.test.ts, workspace.guards.test.ts | tested |
| P4  | Leave, and everything goes.                          | tagged in crypto.test.ts, housekeeping.schedule.test.ts, lifecycle.wipe.test.ts, rewrap.test.ts                                        | tested |
| P5  | Your people's details are never readable in logs.    | tagged in crypto.test.ts, http.test.ts, service.test.ts, workspace.guards.test.ts                                                      | tested |
| P6  | Your data is yours to take, at any time.             | tagged in http.test.ts, lifecycle.move.test.ts, lifecycle.test.ts                                                                      | tested |
| P7  | One person's rows are invisible to everyone else.    | tagged in http.test.ts, service.test.ts, workspace.db.test.ts                                                                          | tested |

The limits stated beside each promise in `DESIGN.md` section 1 are part of the
promise. The home page repeats them.
