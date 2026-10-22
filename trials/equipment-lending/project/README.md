# Workshop Lending

A local browser application for a small community workshop: equipment records,
borrower records, loans and overdue visibility. It uses only Python's standard
library, SQLite and plain HTML/CSS/JavaScript. No packages, external assets or
network services are required.

The current build includes the foundation and **equipment and borrower management**.
The browser supports creating, listing, editing and deleting these records. Loan
checkout/returns and search/report polish are later feature slices.

## Requirements

- Python 3.11 or newer with the bundled `sqlite3` module
- A local browser (Chrome, Firefox, Safari or similar)

Run every command from this project directory.

## Quick start

```bash
python3 -m lending seed --db var/lending.sqlite
python3 -m lending serve --db var/lending.sqlite --host 127.0.0.1 --port 8765
```

Open <http://127.0.0.1:8765/>. Stop the service with `Ctrl-C`.

The seed command is optional if you only want an empty database: `serve`
initializes missing tables automatically. For the demo, seed first.

## Stable command contracts

| Purpose | Command |
| --- | --- |
| Serve the browser app | `python3 -m lending serve --db PATH --host 127.0.0.1 --port PORT` |
| Insert demo data once | `python3 -m lending seed --db PATH` |
| Print the JSON report | `python3 -m lending report --db PATH --as-of YYYY-MM-DD --format json` |
| Run the test suite | `python3 -m unittest discover -s tests -v` |

Notes:

- `serve` defaults to host `127.0.0.1` and port `8765` if flags are omitted, but
  use explicit flags for scripts. It creates a missing database and schema.
  Port `0` chooses a free local port and prints the actual URL.
- `seed` creates a missing database. On an already-seeded database it prints
  `Demo data already present; no records changed.` and exits successfully. It
  never deletes or duplicates existing records.
- `report --format json` prints one JSON document to stdout. Errors go to stderr
  with a nonzero exit code. The date must be a real calendar date written as
  `YYYY-MM-DD`.
- All processes bind locally unless a different `--host` is supplied. There is
  no authentication; do not expose the service to untrusted networks.

### Example report

Using the demo seed and `--as-of 2026-10-22`:

```json
{
  "as_of": "2026-10-22",
  "borrowers": 4,
  "equipment": {
    "available": 7,
    "on_loan": 3,
    "total": 10
  },
  "loans": {
    "active": 3,
    "overdue": 1,
    "returned": 2
  },
  "overdue_loans": [
    {
      "asset_tag": "PT-001",
      "borrower_name": "Maya Chen",
      "days_overdue": 7,
      "due_date": "2026-10-15"
    }
  ]
}
```

The report is computed from database rows, not stored seed totals. Overdue means
an active loan whose due date is strictly before `as_of`; a loan due today is
not overdue. Overdue details sort by due date, then asset tag.

## Demo data and dates

The fictional seed is fixed around **2026-10-22**:

- 10 equipment items in three categories: Power Tools, Hand Tools and Safety.
- 7 items available, 3 on active loan.
- Active overdue: `PT-001` Cordless Drill, due 2026-10-15 (Maya Chen).
- Active due today: `PT-002` Angle Grinder, due 2026-10-22 (Daniel Okafor).
- Active future: `PT-003` Circular Saw, due 2026-10-29 (Priya Raman).
- Returned history: `HT-002` Claw Hammer and `SF-001` Safety Goggles.
- 4 borrowers with `@example.com` addresses.

The browser overview uses **today's local date** for overdue status. If today is
not 2026-10-22, live indicators can differ from the fixed-date report; this is
expected and called out on the page.

A single row in `app_meta` records that the demo seed was applied. To rebuild a
demo database, stop the service and remove `var/lending.sqlite` together with
its `-wal` and `-shm` sidecars, then seed again. Never erase the demo database
to make a test pass; tests use temporary databases.

## Data paths and layout

Runtime data lives under `var/` (ignored by Git). Tests use disposable
temporary databases and ephemeral ports.

```text
lending/
  __main__.py       python -m entry point
  cli.py            serve / seed / report argument handling
  db.py             SQLite connections, pragmas and schema setup
  schema.sql        tables, checks and indexes
  seed.py           fictional fixed-date demo data
  report.py         database-derived counts and overdue details
  server.py         loopback HTTP server, shell, overview and equipment/borrower APIs
  web/
    index.html      browser shell, navigation, management forms and lists
    styles.css      responsive local styling and visible focus states
    app.js          overview loading and equipment/borrower management
tests/
  test_foundation.py
artifacts/          public verification notes
var/                generated runtime data (not committed)
```

### Schema and integrity

- `equipment`: stable ID, name, case-insensitively unique asset tag, category,
  optional notes. Required fields reject blank/whitespace-only values.
- `borrowers`: stable ID, display name, email, optional notes.
- `loans`: equipment and borrower foreign keys, ISO checkout/due/returned dates,
  due date not before checkout, return date not before checkout.
- Foreign keys use `ON DELETE RESTRICT`, so equipment or borrowers with any loan
  history cannot be deleted.
- A partial unique index allows one active loan per equipment item while keeping
  any number of returned historical loans. A repeated or concurrent checkout is
  rejected by SQLite rather than merely by a disabled button.
- The schema and seed writes are transactional. Failed validation leaves prior
  data intact.

These constraints are covered by direct SQLite tests in `tests/`.

## HTTP endpoints

| Method | Path | Response |
| --- | --- | --- |
| GET | `/` | Browser shell (`text/html`) |
| GET | `/styles.css`, `/app.js` | Local static assets |
| GET | `/api/summary` | Same shape as the JSON report, using today's local date |
| GET | `/api/equipment`, `/api/borrowers` | Lists records; equipment includes derived availability |
| POST | `/api/equipment`, `/api/borrowers` | Creates a validated record from a JSON object |
| PUT | `/api/equipment/{id}`, `/api/borrowers/{id}` | Replaces editable fields after validation |
| DELETE | `/api/equipment/{id}`, `/api/borrowers/{id}` | Deletes an unused record; loan history returns a conflict |

Equipment required fields and borrower name/email are trimmed and validated on
the server. Asset tags are case-insensitively unique. Deletion is protected by
the loan foreign keys, including returned history. The browser shows inline
validation and save feedback, retains entered values on failure, and asks for
confirmation with the record name before deleting. There are no external fonts
or images.

## Tests and checks

```bash
python3 -m unittest discover -s tests -v
python3 .workflow/check.py foundation
```

The test suite covers seed/report agreement, repeat-safe seeding without
erasing local records, overdue boundaries and ordering, database-derived report
counts, date validation, required fields, case-insensitive duplicate tags,
single-active-loan enforcement, historical loans, date checks, referenced-record
deletion, CLI contracts, the browser shell and overview API. Equipment/borrower
request-level tests cover create, list, edit, delete, trimming, missing fields,
invalid emails, duplicate tags, and deletion conflicts for loan-referenced records.

`python3 .workflow/check.py foundation` additionally seeds and re-seeds a
temporary database, confirms the fixed-date report is unchanged, starts the
service and requires HTTP 200 from `/`. Its public log is
`artifacts/command-foundation.log`; narrative evidence is in
`artifacts/foundation.md`.

## Current limitations

- Checkout/return flows, search/filter controls and the full overdue list are
  not built yet; they are subsequent feature slices.
- The overview shows counts only; it does not yet list individual overdue loans.
- Reports evaluate the stored active/returned state against the requested
  as-of date. They do not reconstruct historical database snapshots.
- No login, multi-user permissions, reservations, uploads or notifications are
  included, by design.
- The foundation shell was rendered at desktop and phone widths; this CRUD slice
  was verified through HTTP integration tests and static inspection. An
  interactive browser session was not available for this slice, so keyboard
  interaction and updated phone-width rendering remain for independent review.

## Current task evidence

See [`artifacts/task-1.md`](artifacts/task-1.md) for the actual checks, limitations
and handoff for equipment and borrower management.
