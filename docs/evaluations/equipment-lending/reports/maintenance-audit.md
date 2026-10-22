# Independent maintenance audit

## Verdict

**Complete; no defect found that warranted an authorized fix.** This audit exercised the current
implementation using real HTTP requests against temporary SQLite databases and actual Chromium
interactions. The implementation satisfies the requested maintenance paths. No source or test
changes were needed; no demo database was used.

## Commands and actual results

- `python3 -m unittest discover -s tests -v` — passed, 20 tests. This includes migration preservation,
  report/overview maintenance availability, filtering, validated maintenance changes, preservation
  when omitted, trigger rejection of direct SQL checkout, checkout conflict handling and return while
  maintenance remains set. A pre-existing Python `ResourceWarning` occurred for an HTTP 400 response
  in `test_equipment_filters_combine_search_category_and_availability`; suite result was `OK`.
- `node scripts/browser-regression.mjs` — passed in Chromium with a seeded disposable DB and an
  ephemeral local port. Actual browser interactions marked PT-004 under maintenance, observed the
  unavailable status, verified it was excluded from checkout choices, filtered to maintenance,
  cleared the flag and saw it return to checkout choices. The script also exercised the existing
  record form regression.
- `node scripts/maintenance-regression.mjs` — passed in Chromium with its own disposable database
  and ephemeral local port. The browser marked an item after a concurrent ordinary edit and verified
  the renamed value was preserved, verified the count agreement against the available-filter rows,
  exercised maintenance filtering, and cleared the flag. Both scripts closed their browser, stopped
  and reaped their server, and removed their temporary state.
- Ran an additional direct Python HTTP/SQLite probe against a hand-built v1 database. After
  `open_database(create=True)`, equipment ID 7 and loan ID 9 remained intact, `under_maintenance`
  defaulted to 0, and `/api/equipment`, `/api/loans?state=active`, and `/api/summary` returned HTTP
  200 with matching active-loan data. A checkout attempt was rejected (409 because the item was
  already on loan); setting maintenance returned 200; returning the active loan while maintained
  returned 200; a subsequent checkout was rejected with HTTP 400 and the maintenance message.
  Server thread was joined and the server closed before the temporary directory was removed.

## Requirement-by-requirement findings

- Existing-schema migration preserves records and IDs and supplies false for legacy rows; migration
  and repeat initialization are covered in the automated suite. The direct HTTP probe also verified
  legacy active-loan visibility after migration.
- The HTTP maintenance endpoint changes the state. Request/storage tests reject malformed input,
  ordinary omitted input preserves the flag, and the SQLite trigger blocks direct insert attempts for
  a maintained item. Checkout and maintenance changes use immediate transactions.
- Marking an on-loan item does not interfere with return. The flag survives return and prevents a
  new checkout until cleared.
- Search/category/availability filtering composes, maintenance filtering is available, and maintained
  records are excluded from available choices. The browser runs verified mark/clear and choice refresh.
- The report and `/api/summary` use the same database-derived counts. `available` excludes both
  active loans and maintenance. `on_loan` and `under_maintenance` independently count their states
  and can overlap, as specified/documented. The required Chromium regression directly compared the
  overview available count with available-filter result length.

## Limits

This audit did not conduct a broad keyboard-only, desktop/phone visual, or responsive accessibility
inspection. Concurrency behavior is protected by transactions, a unique partial index and a trigger;
this run did not repeat a high-volume stress race. No external workflow execution or demo database
was used. No owned process remains running.
