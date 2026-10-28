# Payload CMS, run and read, 2026-10-27

Evidence behind `DESIGN.md` section 12 (what was borrowed from Payload and what was left). Payload is an
open-source admin and content system. It was studied for interface and system-design ideas only; no code or visual
design was copied.

## How it was studied

- **Source.** A shallow clone of the main branch, read for the admin's navigation, preferences, versions, trash,
  authentication and production guides (`docs/production/deployment.mdx`, `docs/production/preventing-abuse.mdx`).
- **Run live.** The blank starter on the `4.0.0-beta.5` packages (the line the cloned source is on; the stable line
  was `3.92.1`), with SQLite, on Node 24, in a scratch folder outside this repository. One extra collection was
  added with drafts, versions, soft delete and a field only its owner may change, and the user collection was given a
  three-attempt login lock. A second user was created for the access checks.
- **Driven with a browser** at 1440, 820 and 390 pixels wide, in light and dark, and over its HTTP API as the owner,
  as a second signed-in user and as an anonymous caller. Every statement under "Observed" below was seen in that
  run; anything read only from source or documentation says so.
- **The public site.** One screenshot of the product site's footer was supplied separately and is described under
  "The product site's footer".

Not done: the hosted one-click deployment, Payload's own production hardening, and the phone layout on a real device.

## Observed in the running admin

| Area              | What it does                                                                                                                                                                                                                              | Our position                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| First run         | No users yet: the first visit is a "create first user" form, and that user owns the install.                                                                                                                                               | Not compared.                                                                                              |
| Dashboard         | A welcome line, **Pinned** and **Recently viewed** tabs with a quiet empty state, then collection cards grouped by the config's group names.                                                                                              | Candidate: a recent strip on the kitchen home (below).                                                     |
| Sidebar           | Tabs for Collections, Folders and Tags; groups with headings; the open or closed state of the bar, and of each group, is a saved **user preference** (server-side, so it follows the person to another device) passed in at first paint. | Ours is per device (local storage). Left as is: the hide state is cosmetic.                                |
| Collapsing        | The toggle sits at the top of the bar; collapsed, the content takes the whole width and the toggle moves to the page's top-left.                                                                                                          | Same as ours.                                                                                              |
| List view         | Search, **Filters** (an inline "Where field operator value" builder with Add Filter), **Group by**, **Columns**, a table or card toggle, per-page and a **Trash** tab in the header.                                                       | Candidate: a field filter on the ledger and orders lists.                                                  |
| Edit view         | Tabs **Edit / Versions (count) / API**; a status line ("Published", "Updated less than a minute ago"); **Save Draft** and **Publish** stay disabled until something changes.                                                              | Candidate: the same "disabled until changed" behaviour on our forms.                                       |
| Versions          | A table of Updated At, Status and Version ID. The compare view shows the two versions side by side, with character-level highlights, a **Modified only** switch and **Restore this version**.                                            | Ours also names **who** (below). The "changed fields only" switch is a candidate for History.              |
| Account           | **Theme: Automatic / Light / Dark**, **Enhanced Contrast Mode**, **Reset Preferences**, and **Force unlock** for a locked user. The same theme choice is in the user menu.                                                                | We follow the system only, outside the documentation. Adopted (below).                                     |
| Dark              | A flat neutral grey, with the same layout.                                                                                                                                                                                                | Ours is tinted to the kitchen's green and is kept.                                                         |
| Phone (390 px)    | No bottom bar: the sidebar is a drawer. In the list the "Create New" button is overlapped by the view toggle and the table scrolls sideways with columns cut off. The edit view stacks cleanly.                                           | Our bottom bar and card rows are the stronger answer for daily use.                                        |
| Errors            | Wrong password gives one message that does not say how many tries remain. After the lock, the message changes to "This user is locked due to having too many failed login attempts", and the **correct** password is refused until the lock ends. | See "What the abuse checks showed".                                                                        |

## What the abuse checks showed

Each was run against the live admin and its API.

1. **Deleting through the API is permanent by default, even where trash is on.** The admin screen soft-deletes unless
   the box to skip the trash is ticked, but a plain `DELETE` on the API returned 200 and the document was gone
   (`trash=true` on the read returned 404). Only `DELETE ...?trash=true` moved it to the trash. **The record's
   versions were deleted with it** (zero remained). In a books app a delete that also erases the history is the
   opposite of what we promise. Ours: a person can remove only an entry or claim the rules still allow (their own,
   before it is decided or the month is closed), and the database writes the row's before-image and who did it to
   an audit log that cannot be changed or deleted (`audit_row` runs on `DELETE` too). Removing a record never
   removes its history.
2. **A field the caller may not change is dropped silently.** A second user sent a forged value for the owner-only
   field and the same request's allowed change (`amount`); the answer was 200, the owner-only field kept its old
   value, and nothing said the forgery had been ignored. Safe for the data, silent for the person. Ours is mixed:
   what a role may do is checked per request and refused with a reason (403), and author and time are stamped by
   the database, so a forged author or time has no effect. But the request validators **strip unknown keys rather
   than reject them**, so a forged extra field is also ignored without a word. Rejecting unknown keys is a
   candidate (below); it would make an attempt visible.
3. **The starter's default access is "any signed-in user".** A second, ordinary user could delete a record it did
   not create (200). Payload documents this and expects each project to write its own rules. Ours is deny-by-default
   in the database (forced row security), so a missing rule fails closed.
4. **Authorship is now stamped by the server.** The `4.0` migration notes say collections gain `createdBy` and
   `updatedBy`, set from the signed-in user on every write, on by default. This is the principle ours already follows
   (author and time are stamped by the server, never accepted from the client). In the admin, though, the Versions
   table shows no author column, so the stamp is there but not on screen. Ours shows it on the History screen.
5. **History is bounded.** Source and documentation: versions are kept per document up to `maxPerDoc`, **100 by
   default**, and older ones are pruned. Ours keeps every row.
6. **The lock can be used against the person it protects.** Three wrong tries lock the account for the set time and
   even the right password is refused, so anyone who knows an email can keep that person out; the changed message
   also confirms the email is registered. Payload provides **Force unlock** for the administrator. Ours has no
   passwords to guess: sign-in is through an identity provider (OIDC), so there is no lock to abuse.
7. **No security headers in the dev server.** The login page answered with `cache-control: no-store` and none of
   `Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security` or `X-Content-Type-Options`. Payload's
   own deployment guide says it does not set them and leaves them to the project. A development server may differ
   from a production build, so this is a note, not a verdict. Ours ships a strict policy from the first release, and browser
   tests check the headers on the app and on both documentation sites.
8. **Anonymous callers were refused** on every collection (403) and the GraphQL route answered 405 to a plain GET.

## The product site's footer

From the supplied screenshot of the public site's footer (not fetched or run):

- A dark page with a sticky top bar: logo, five links, the repository's star count, Login, a Get Started button and
  a search icon.
- A footer of **four columns divided by hairline vertical rules**: three of links, the fourth holding an email
  sign-up, four social icons and a **theme select reading "Auto"**.
- A very large, faint wordmark across the foot of the page, cropped at the bottom edge.

Against ours: the wordmark footer is already in the home page (it was built from an earlier reference). Two things
were not: the **theme choice in the footer**, and the **ruled columns** that give a long link list some order. The
theme choice is the one adopted; see `DESIGN.md` section 12.

## The landing page and footer, looked at in a browser

Run against the public site, at 1440 pixels, in dark, with the pointer driven by the test and with reduced motion
emulated. Described here for what each thing does; none of it was copied.

- **The wordmark responds to the pointer.** The very large name at the foot is a faint, grain-textured grey set
  into black. A soft round light, about 1100 pixels across, follows the pointer (two custom properties, `--mouse-x`
  and `--mouse-y`, updated as it moves) and the letters come up only where it passes. Away from it the name is
  nearly invisible. The name is cropped at the bottom edge.
- **What keeps moving on the landing page** is one looped, muted background video behind the headline, 30 seconds
  long, of slow bands of blue and amber light, under a fine dotted texture and a hairline column grid. It fades
  in over two seconds. Further down, the product mock-ups are drawn mid-action (a text selection in progress, a
  labelled collaborator's cursor, a focused field), which is where the page shows what the product does.
- **It does not honour reduced motion for that video.** With the preference set, the video kept playing at normal
  speed (its clock advanced three seconds in three). That is a flaw to avoid, not a thing to learn from.
- **Layout:** ruled columns in the hero and the footer, a sticky top bar with the repository's star count and a
  search icon, and a theme select in the footer.

What was made of it here, in this project's own terms: the name dims into the wall and a **warm light, the colour of
the turmeric accent, follows a pointer across it and wanders along it on its own when nobody is pointing**. For the
motion on the first screen, Payload's looped video became **steam drawn from behind the lids of the carrier and the pot**,
a few lines each with its own length, thickness and pace, so the whole never visibly repeats. Both move only while in view,
stop when the tab is hidden, and stay still under reduced motion (the name's light then rests in the middle and still
follows a hand, which is the person's own movement; the steam is drawn in full). No video: a looped video is megabytes the
page does not need, and a stylesheet can draw the same slow motion.

## Borrowed, left, and candidates

| Decision      | Item                                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Borrowed once | Grouped, hideable menu; one list driving navigation and roles; production checklist; abuse-prevention checklist.                                                           |
| Adopted now   | A pointer-following light over the footer name, and steam from behind the lids on the first screen, drawn in this project's colours and stopping under reduced motion. One theme choice (Automatic, Light, Dark) kept in one place and used by the app, the home page, the guides and the docs, with the control in the footer and in the app.    |
| Left          | Server-side saved layout preferences; a bottom-less phone layout; silent field dropping; permanent delete; a lock that refuses the right password; flat grey dark mode.    |
| Candidates    | A "recent" strip on the kitchen home; a field filter on the ledger and orders lists; "changed fields only" in History; ruled columns in the footer; rejecting unknown keys in request bodies. |

## Reproducing the run

1. Copy the starter folder out of the cloned `templates/blank`.
2. Replace the `workspace:*` versions with `4.0.0-beta.5`, swap the database adapter for `@payloadcms/db-sqlite`, and
   set `PAYLOAD_SECRET` and `DATABASE_URL=file:./study.db`.
3. Install with npm on Node 24 or later (the packages require it), then `next dev`.

Version numbers, defaults and behaviour were true on the date above and will move; re-run before relying on any row.
