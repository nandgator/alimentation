# Promises ledger

Every claim on the home page is listed here with the test that proves it. A test
proves a promise by carrying the tag `[P<n>]` in its name. `scripts/check-promises.mjs`
fails the build when a promise has no tagged test, or a tag names no promise.

| ID  | Promise                                              | Proof (tagged tests)       | Status  |
| --- | ---------------------------------------------------- | -------------------------- | ------- |
| P1  | Nobody can crowd you out.                            | to be added with M2 and M3 | pending |
| P2  | Free until you outgrow it, and we say so in advance. | to be added with M3        | pending |
| P3  | Outgrow it, move in one click, lose nothing.         | to be added with M4        | pending |
| P4  | Leave, and everything goes.                          | to be added with M4        | pending |
| P5  | Your people's details are never readable in logs.    | to be added with M2        | pending |
| P6  | Your data is yours to take, at any time.             | to be added with M4        | pending |
| P7  | One person's rows are invisible to everyone else.    | to be added with M2        | pending |

The limits stated beside each promise in `DESIGN.md` section 1 are part of the
promise. The home page repeats them.
