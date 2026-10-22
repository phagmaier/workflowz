# Maintenance state implementation evidence

## Behavior and contracts

Equipment records have an integer SQLite `under_maintenance` flag constrained to
0 or 1 and defaulted to 0. Schema version 2 adds it to version 1 databases without
changing equipment, borrower or loan IDs/history. Repeated initialization and the
existing seed marker remain safe.

`GET /api/equipment` returns `under_maintenance` as a boolean-like SQLite integer.
The existing `availability` filter accepts `all`, `available`, and `on-loan`, plus
`maintenance`. Available means no active loan and no maintenance flag. On-loan and
maintenance filters are independent and may overlap. Search and category filters
continue to combine with availability.

Equipment create accepts an optional JSON boolean `under_maintenance` (default
false). Equipment `PUT` accepts the same boolean; when omitted, the stored flag is
preserved. Strings, numbers and null are rejected. `POST /api/equipment/{id}/maintenance`
accepts exactly `{ "under_maintenance": true|false }` and changes only that flag.
The browser card uses this flag-only endpoint, preventing stale list fields from
overwriting newer equipment edits. In the edit form, maintenance is sent only if
the operator changes its checkbox; leaving it untouched preserves the stored value.
Checkout choices and available filtering exclude maintained items.

`POST /api/loans` checks current maintenance inside its `BEGIN IMMEDIATE`
transaction and returns HTTP 400 with a clear message if the item is maintained.
Maintenance updates use the same immediate transaction, so an update racing with
checkout is serialized. A SQLite `BEFORE INSERT` trigger independently rejects
direct inserts for maintained equipment. Existing active loans remain returnable;
returning does not change maintenance. Clearing the flag makes an otherwise
available item eligible again.

The existing JSON report shape is retained with
`equipment.under_maintenance` added. It counts every flagged item, including those
currently on loan. `equipment.on_loan` counts items with active loans independently,
so these counts can overlap. `equipment.available` excludes both states. `/api/summary`
uses the same count semantics.

## Actual verification

- `python3 -m unittest discover -s tests -v` — final run passed, 20 tests. Includes v1
  schema migration with preserved IDs/history and repeat initialization, API flag
  validation and omission preservation, direct SQLite trigger rejection, maintenance
  reporting, active loan return without auto-clear, and maintained-but-unloaned report
  availability coverage. A pre-existing `ResourceWarning` for an unclosed HTTP 400 in
  the invalid-filter test appeared; suite exit was 0.
- `node scripts/browser-regression.mjs` — passed using Chromium channel `chromium`,
  a seeded disposable DB and ephemeral local port. It marks seeded PT-004 maintained,
  observes status and maintenance filtering, confirms PT-004 disappears from checkout
  choices, clears maintenance, confirms eligibility returns, and runs the existing
  equipment/borrower clear/save/error/edit reset regression. Script closes Chromium,
  stops/reaps the server and removes its temporary directory.
- `node scripts/maintenance-regression.mjs` — passed using a separately seeded
  disposable database, ephemeral localhost server and Chromium. It changed PT-004's
  name through a request after the card loaded, marked maintenance from the stale card,
  and verified the newer name remained. It also confirmed overview `equipment.available`
  equals `GET /api/equipment?availability=available`, checked maintenance filtering,
  and cleared the flag to restore checkout eligibility. Browser, server and temporary
  data were settled in `finally`.
- Disposable CLI report check — seed twice, then run
  `python3 -m lending report --db PATH --as-of 2026-10-22 --format json`; first seed
  created 10 items/4 borrowers/5 loans, second seed reported no changes, and report
  equipment counts were `available=7`, `on_loan=3`, `under_maintenance=0`, `total=10`.
- No visual screenshot, broad keyboard audit or phone-width inspection was run in this
  maintenance slice. No demo database or evaluator-owned workflow input was changed.
