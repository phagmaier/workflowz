# Maintenance delta review

Verdict: **changes**. The migration, flag validation, checkout guard, trigger, return-while-maintained
and concurrency behavior pass. The report/summary `equipment.available` count is wrong for maintained
items, contradicting both the availability filter and the artifact's own stated contract. The required
`scripts/maintenance-regression.mjs` is missing.

No app source was modified. Probe scripts lived outside the project in `/tmp/maint-review-probes/` and
used temporary databases only; the demo database was not touched.

## Defects

1. **Report and overview `available` ignore maintenance** (`lending/report.py`, `build_report`, the
   `equipment_available` query). The query counts items with no active loan, so a maintained item is
   still counted as available. Contract (`artifacts/maintenance.md`, MAINTENANCE.md) says
   `equipment.available` excludes both on-loan and maintenance states.
   - Reproduction: fresh DB with one maintained, unloaned item (`Mill`) and one available item.
   - Actual: `report --format json` / `/api/summary` → `available: 2, under_maintenance: 1`.
   - Actual: `GET /api/equipment?availability=available` → 1 row.
   - Browser: overview stat `equipment.available` = 7 while `availability=available` returns 6 after
     marking "Claw Hammer" (id 6) under maintenance on the seeded demo copy.
   - Expected: `available` = items with no active loan AND `under_maintenance = 0`.
   - Fix direction: add `AND under_maintenance = 0` to the `equipment_available` query. Add a report
     test where a maintained, unloaned item is counted in `under_maintenance` but not `available`.

2. **Required regression script is missing.** MAINTENANCE.md requires
   `scripts/maintenance-regression.mjs`. Only `scripts/browser-regression.mjs` exists.
   `artifacts/maintenance.md` describes the browser maintenance flow as part of the existing script, but
   the required named file was not created. Add it, or document the requirement change in DESIGN/README.

3. **Stale-form overwrite in the card action** (`lending/web/app.js` ~L104–107). "Mark/Clear maintenance"
   PUTs `name`, `asset_tag`, `category`, `notes` from the list snapshot in memory. If the record changed
   since the page loaded, the toggle silently reverts those fields. The edit form has the same pattern
   for the checkbox. Not a checkout bypass, but it conflicts with "ordinary edits must not accidentally
   clear state". Low severity; fix by sending only the flag, or by re-reading before PUT.

## Executed checks

| Check | Command / method | Outcome |
| --- | --- | --- |
| Unit/integration tests | `python3 -m unittest discover -s tests -v` | Ran 19 tests, `OK` |
| Existing browser regression | `node scripts/browser-regression.mjs` | Printed `PASS` for maintenance toggle/filter/checkout exclusion and equipment/borrower reset checks |
| Old-schema migration | HEAD `lending/schema.sql` DB with equipment IDs 7, 9, borrower 3, loans 11 (returned) and 12 (active), then `open_database(create=True)` | Columns gained `under_maintenance` default 0; IDs, notes, loan IDs and dates preserved; `user_version=2`; trigger created; repeat init OK; report correct (`active 1, overdue 1, returned 1`) |
| Flag validation (create) | `under_maintenance` = `"yes"`, `1`, `0`, `None`, `"true"` | All 400 |
| Flag validation (update) | omitted → preserved; `null` → 400; `"false"` → 400 | As expected |
| Checkout on maintained item | `POST /api/loans` | 400 with clear message |
| Direct SQL bypass | `INSERT INTO loans` for maintained item | Rejected by trigger |
| Direct SQL bad flag | `under_maintenance=2` | Rejected by CHECK |
| Mark while on loan, return | PUT flag true during active loan, then PATCH return | Return 200; flag stays 1 |
| Filter agreement | `availability` = all/available/on-loan/maintenance | 2 / 1 / 0 / 1; `bad` → 400 |
| Report vs summary vs filter | report, `/api/summary`, filter | Total/on_loan/maintenance agree; **available disagrees** (defect 1) |
| Checkout race | 20 concurrent `POST /api/loans` on one free item | 1×201, 19×409, 1 active loan |
| Maintenance vs checkout race | concurrent PUT maintenance=true and POST loan | Toggle 200 and checkout 400; final flag 1, active loans 0 (serialized correctly) |
| CLI seed repeat | `seed` twice on temp DB | Both exit 0 |
| CLI report | `report --as-of 2026-10-22 --format json` on seeded temp DB | Exit 0; `total 10, available 7, on_loan 3, under_maintenance 0` |
| CLI bad input | `--as-of 2026-02-30`; missing DB | Exit 2 and exit 1; error on stderr |
| Browser overview vs filter | Playwright Chromium, seeded temp DB, one item marked via API | Overview `available` 7 vs filter 6 (defect 1); server and temp dir cleaned up |

## Not performed

- Keyboard-only, desktop/phone visual, and responsive inspection of the maintenance controls.
- A dedicated browser test for the Clear maintenance flow beyond the existing regression script.
- Long-running stress testing; the concurrency probes were short bursts.

## Decision

Changes required: fix the `available` count (with a test), add `scripts/maintenance-regression.mjs`
or update the requirement, and consider the stale-form overwrite in the maintenance toggle.
