# Foundation verification notes

Date: 2026-10-22
Runtime: Python 3.15.1 on Linux, standard-library `sqlite3`, no installed packages.

This note records checks actually run while building the foundation slice. The three
feature slices in `TASKS.md` are intentionally not implemented; the service, schema,
repeat-safe seed, JSON report and browser shell are runnable now.

## What the foundation provides

- `lending/` package with `serve`, `seed` and `report` subcommands (`python3 -m lending`).
- `lending/schema.sql` with stable integer IDs, required-field checks, a case-insensitive
  unique asset tag, foreign keys with `ON DELETE RESTRICT`, date-order checks, and a
  partial unique index that permits one active loan per item while retaining history.
- `lending/seed.py` with 10 fictional items in 3 categories, 4 borrowers and 5 loans dated
  around the fixed demo date 2026-10-22. An `app_meta` marker makes repeat seeding a no-op.
- `lending/report.py` computing every total from live rows, with strict `YYYY-MM-DD`
  parsing and deterministic overdue ordering (due date, then asset tag).
- `lending/server.py` serving the shell, local CSS/JS and `GET /api/summary` on loopback,
  with a strict path check and a content security policy for the HTML entry point.
- `lending/web/` browser skeleton with overview counts, navigation placeholders, skip link,
  responsive styles and visible focus styling.
- `tests/test_foundation.py` with 11 tests covering seed/report agreement, repeat-safe
  seeding, overdue boundaries/order, database-derived totals, date validation, required
  fields, duplicate tags, one-active-loan enforcement, history, deletion restrictions,
  CLI contracts and the HTTP entry points.

## Commands and observed outcomes

### Automated suite

```console
$ python3 -m unittest discover -s tests -v
...
Ran 11 tests in 0.119s
OK
```

The suite uses `tempfile.TemporaryDirectory` databases and an ephemeral port (`create_server(..., 0)`),
never `var/lending.sqlite`.

### Required foundation check

```console
$ python3 .workflow/check.py foundation
...
Ran 11 tests in 0.115s
OK
Seeded 10 equipment items, 4 borrowers and 5 loans.
...
Demo data already present; no records changed.
serve: HTTP 200; repeat seed/report: stable
```

The full evaluator log is `artifacts/command-foundation.log`. The check also asserts that a
second seed leaves the fixed-date report byte-identical and that the browser entry point
returns a nonempty HTTP 200 response. Exit status was 0.

### Clean database, seed and report

```console
$ tmp=$(mktemp -d /tmp/opencode/foundation-check.XXXXXX)
$ python3 -m lending seed --db "$tmp/demo.sqlite"
Seeded 10 equipment items, 4 borrowers and 5 loans.
$ python3 -m lending report --db "$tmp/demo.sqlite" --as-of 2026-10-22 --format json
{... "as_of": "2026-10-22", "borrowers": 4,
 "equipment": {"available": 7, "on_loan": 3, "total": 10},
 "loans": {"active": 3, "overdue": 1, "returned": 2},
 "overdue_loans": [{"asset_tag": "PT-001", "borrower_name": "Maya Chen",
                    "days_overdue": 7, "due_date": "2026-10-15"}]}
$ python3 -m lending seed --db "$tmp/demo.sqlite"
Demo data already present; no records changed.
$ # second report compared with cmp: identical
repeat report identical
```

Direct SQLite inspection of the same database agreed with the report:

```text
equipment 10
borrowers 4
loans 5
active 3
overdue@2026-10-22 1
integrity ok
```

### Error handling

| Command | Exit | stderr |
| --- | --- | --- |
| `report --as-of 2026-02-30` | 2 | `error: as-of date is not a real calendar date: 2026-02-30` |
| `report --db missing.sqlite` | 1 | `error: database not found: ... (run the seed command first)` |
| `report --format xml` | 2 | argparse rejects the choice |

No existing data was modified by these failures.

### HTTP behaviour

With `serve --db <seeded temp db> --host 127.0.0.1 --port 8799`:

- `GET /` returned `200`, `text/html; charset=utf-8`, `Cache-Control: no-store`,
  `X-Content-Type-Options: nosniff`, and a CSP of
  `default-src 'self'; script-src 'self'; style-src 'self'; ...`.
- `GET /api/summary` returned the same counts as the report for today's local date
  (2026-10-22 during this check): 10 total equipment, 7 available, 3 on loan,
  1 overdue, 4 borrowers.
- `GET /styles.css` returned `200 text/css; charset=utf-8`.
- `GET /api/missing` and the encoded traversal `GET /%2e%2e/README.md` both returned `404`.

A separate `serve` run against a database path that did not exist created and initialized
it. Its summary and report both returned zero counts, and the process was terminated
cleanly before continuing.

### Browser skeleton

The page was rendered with the installed Chromium in headless mode and refreshed at:

- desktop: 1440 × 1000 → `artifacts/foundation-desktop.png`
- phone: 390 × 844 → `artifacts/foundation-phone.png`

In both renders the overview fetched `/api/summary` and displayed 10 equipment / 7 available,
3 on loan / 3 active loans, 1 overdue and 4 borrowers. The four-column statistics collapse to
two columns at phone width, the navigation wraps without horizontal scrolling, and the demo
date caveat is visible.

Limitations of that inspection:

- No interactive desktop browser session was connected to this harness, and the Playwright
  launcher could not find its configured Chrome distribution. Keyboard tab traversal,
  focus-ring visibility in a real browser, and click/hover behaviour were therefore **not**
  exercised. Only the rendered output and the static HTML/CSS were inspected.
- The only interactive elements in this foundation are navigation anchors and the skip link;
  forms, filters and action buttons arrive with the feature slices.

## Deviations and handoff notes

- Equipment/borrower CRUD, checkout/return, filters and individual overdue rows are not
  present yet. The three navigation panels are labelled placeholders for the next slices.
- The schema enforces nonblank borrower name/email but not full email plausibility. The
  equipment/borrower slice should validate a plausibly formed email in the service layer
  (and may tighten the schema through a versioned change).
- `PRAGMA user_version` is 1. A later schema change should add an explicit migration instead
  of assuming existing databases pick up edited `CREATE TABLE` statements.
- `report` reads the current rows for the requested as-of date; it does not reconstruct a
  historical snapshot of the database.
- The demo database `var/lending.sqlite` was not deleted or reseeded during these checks.
  Temporary check databases were removed, and no lending server processes were left running.
