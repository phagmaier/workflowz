# Review 3 — Search, overdue visibility and deterministic reports

Reviewer checks only; no fixes applied. Outcome: **changes**.

## Findings

1. **Category filter goes stale after equipment mutations** (`lending/web/app.js:140`, `:151`, submit/delete handlers ~`:187`, `:213`).
   - `loadEquipmentCategories()` runs only once at page load. Create, edit and delete call `refresh(config)` and `loadOverview()` but never repopulate `#equipment-category`.
   - Reproduction: start the service, create equipment with a new category (e.g. `Machines`) via the form. The API returns it (`GET /api/equipment` includes `ZZ-1` with category `Machines`, verified), but the Category select does not offer `Machines` until page reload. Deleting the last item in a category likewise leaves a dead option.
   - Expected: category choices reflect current records (README claims this). Actual: stale until reload.
   - Impact: the search/category/availability combination cannot find newly created equipment by category without reloading.

2. **Loan overdue filter has no boundary test** (`tests/test_foundation.py`, `_send_loans` in `lending/server.py`).
   - The strict boundary (due today is not overdue, due yesterday is) is tested only through `build_report`. `GET /api/loans?state=overdue` uses `date.today()` and is not exercised at a boundary by any test; the tests only hit `state=active` and `state=returned`.
   - Expected per SPEC: loan filter for overdue matches the report boundary. Not demonstrated by tests.

## Checks executed

- `python3 -m unittest discover -s tests -v` — 15 tests, OK. (Run without `-I`; `-I` breaks the `lending` import.)
- `python3 -m compileall -q lending tests` — OK.
- Temp server (seeded temp DB, port 8791), stopped after use:
  - `search=%` → 0 rows; `search=_` → 0 rows (wildcards escaped correctly).
  - `search=pt-00&availability=available` → `PT-004` only (case-insensitive, combined).
  - `category=Nope` → `[]`; `availability=ON-LOAN` → HTTP 400; `availability=on-loan` → PT-001/002/003.
  - `/api/loans?state=overdue` → PT-001 due 2026-10-15; `state=bogus` → 400.
  - `POST /api/equipment` with new category → 201; `/api/summary` total 11, available 8, overdue 1 (`as_of` 2026-10-22, matching report shape).
  - `POST /api/loans` with due before checkout → 400 with message.
- Headless Chromium screenshots (temp DB, server stopped after): phone 390px and desktop 1280px render without overlap; overview shows the live-date callout, counts, overdue list with text labels (not color alone).
- Source inspection: search escaping, `ORDER BY due_date, asset_tag, id` in `report.py`, seed marker and transactional insert in `seed.py`, live-date callout in `index.html:38`, focus-visible styles in `styles.css:46`.

## Not performed

- Interactive keyboard-only walkthrough and screenshot-based focus inspection in the browser (only static screenshots).
- `python3 .workflow/check.py foundation` was not run because it overwrites `artifacts/command-foundation.log`.
- Live-date mismatch behavior was not exercised with a non-2026-10-22 system date.

## Handoff

Fix finding 1 by calling `loadEquipmentCategories()` after successful equipment create/update/delete (and on error-free refresh), preserving the current selection. Add an API test for `/api/loans?state=overdue` at due-yesterday/due-today boundaries. Then rerun the unittest command and re-verify the category dropdown after creating a new category.
