# Task 3 — Search, overdue visibility and deterministic reports

Date: 2026-10-22

## Delivered

- Added server-side equipment filters at `GET /api/equipment`: case-insensitive
  substring search across name and asset tag, exact category, and derived
  `all` / `available` / `on-loan` availability. Supplied filters combine and
  result ordering is stable.
- Added equipment search, category and availability controls to the browser UI.
  Category choices come from current equipment; search updates while typing.
- Added an overview overdue detail list, using the existing database-derived
  summary/report payload for counts and individual overdue rows. It displays
  tag, borrower, due date and days overdue, and has an empty state.
- Preserved the fixed 2026-10-22 seed/report contract. README now documents
  filters, current live-date behavior, task evidence and limits.
- Added request-level integration coverage for combined filters, ordering,
  invalid availability values, and summary/report agreement.

## Checks actually run

- `python3 -m unittest discover -s tests -v` — **passed**, 15 tests. Includes
  the existing overdue strict-boundary and deterministic ordering test, seed
  repeat-safety and database-derived report checks, plus the new equipment
  filter and summary agreement request tests.
- Disposable CLI/database check using a temporary directory — **passed**. First
  seed inserted 10 equipment, 4 borrowers and 5 loans; second seed reported no
  changes. JSON report for `2026-10-22` reported 10 equipment (7 available,
  3 on loan), 4 borrowers, and 3 active / 1 overdue / 2 returned loans. Its
  overdue details listed PT-001 / Maya Chen / 2026-10-15 / 7 days. Direct SQLite
  counts agreed: `(10, 4, 5)`.
- The first run of the newly added equipment filter test exposed a SQL `ESCAPE`
  literal error; corrected it and reran the full suite successfully.
- All test servers were started in test threads and shut down/joined by their
  tests. No demo database was used or changed.

## Limitations and handoff

- No interactive browser was used for this task. Keyboard focus, filter interaction
  in a real browser, and current desktop/phone rendering were not visually
  inspected; the new controls include labels and retain the existing visible
  focus styling, but those observations remain for independent review.
- Loan correction/deletion and maintenance state remain out of scope.
- Equipment query contract is `search`, `category`, and `availability=all|available|on-loan`;
  `search` matches name or tag and all provided criteria are ANDed. Invalid
  availability returns HTTP 400.

## Review follow-up

Review cause and fixes:

- **Stale category choices after equipment changes:** category choices were
  populated only at initial page load. Creating an equipment item in a new
  category did not make that category selectable until reload, and deleting
  the last item left an obsolete choice. Successful equipment create, edit and
  delete now repopulate the category menu. A category selection is retained
  when it still exists; otherwise the menu returns to All categories.
- **No API boundary test for the overdue loan filter:** strict overdue boundary
  had only been tested through the report builder, while the loans endpoint
  independently filters against the current date. Added an HTTP integration
  regression that includes an active loan due yesterday, an active loan due
  today, and a returned loan due yesterday; only the first appears in
  `state=overdue`.

Checks actually run for this follow-up:

- `python3 -m unittest discover -s tests -v` — **passed**, 16 tests. The new
  overdue endpoint boundary test passed, and the existing combined equipment
  filter/API and report/seed tests also passed.
- The test servers were shut down and joined by their tests; only temporary
  database files were used.

No second review loop was requested. Interactive browser verification of the
category selector mutation behavior remains unperformed; this fix is covered
through source-level flow and API regression coverage, with the earlier visual
inspection limitation unchanged.
