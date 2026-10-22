# Review 2 — Checkout, returns and loan history

Reviewer: independent slice review, 2026-10-22. No fixes were implemented.

## Verdict

**Changes.** The server-side loan rules hold up under the checks below. The browser
loan workflow leaves the equipment list showing stale availability after checkout and
return.

## Findings

### 1. Equipment availability is stale after checkout or return (must fix)

- `lending/web/app.js:202` and `lending/web/app.js:226` refresh only the loan list, the
  checkout choices and the overview after a return or checkout. Neither path refreshes
  the equipment card list. `refresh(config)` for equipment runs only on page load
  (`app.js:114`) and after equipment save or delete (`app.js:95`, `app.js:138`).
- Reproduction: load the page; check out an available item (for example PT-001) with the
  checkout form, or record a return from the loan list.
- Expected: the equipment card for that item shows "On loan" after checkout and
  "Available" after return, without a reload. The task asks for action outcomes to be
  clear in the UI.
- Actual: the equipment card keeps its load-time status until the page is reloaded.
- Suggested fix: include `refresh(configs[0])` (or the equipment refresh) in both
  `Promise.all` calls.

### 2. Minor, non-blocking: due-today loans read as "Active"

- `lending/web/app.js:191` labels any unreturned loan that is not overdue as "Active". A
  loan due today therefore has no distinct label. Acceptance item 4 in `SPEC.md` asks for
  overdue, due-today and returned to be distinguished. This slice does not strictly
  require it, so it is a note for the next slice.

## Verified correct (no action)

- Checkout race: 12 simultaneous `POST /api/loans` for one item produced one 201 and
  eleven 409s, leaving one active row.
- Early return (before checkout) returns 400 and leaves `returned_date` unset.
- Repeated return returns 409 and keeps the original `returned_date`.
- Re-checkout after return returns 201.
- Malformed or impossible dates, due before checkout, boolean/non-integer/missing IDs,
  extra keys, non-object JSON, invalid `state`, and a missing loan on PATCH all return
  4xx without mutation.
- Deleting a borrower with loan history returns 409.
- Restart persistence is covered by `tests/test_foundation.py`
  (`test_checkout_return_conflicts_dates_and_restart_persistence`).
- Checkout keeps entered values and the selected equipment after a failed request
  (`app.js:227`).

## Checks executed

| Command | Outcome |
| --- | --- |
| `python3 -m unittest discover -s tests -v` | Passed, 13 tests |
| `python3 -m compileall -q lending tests` | Passed |
| Live API probe (`/tmp/review-2/probe.py`, disposable DB `/tmp/review-2/probe.sqlite`, ephemeral port) | Behaved as listed under "Verified correct"; server stopped afterward |

The probe script lives outside the project. No files in the project were changed, and no
server was left running.

## Not performed

- Interactive browser checks: keyboard operation, visible focus, desktop and phone
  widths, and the stale-availability repro above. A Chromium binary exists at
  `/usr/bin/chromium`, but no automation driver is installed in the project, so these
  were not run. Finding 1 rests on source reading.
