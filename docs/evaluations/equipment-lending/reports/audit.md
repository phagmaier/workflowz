# Independent baseline audit

## Scope and method

Audited the integrated source against `SPEC.md` and ran project checks independently in this invocation. Used test databases and ephemeral local server ports; did not modify or use `var/lending.sqlite` or `var/evaluator-browser.sqlite`. The OMP integration report was treated as a handoff, not as audit evidence. No browser inspection is claimed.

## Actual checks run

- `python3 -m unittest discover -s tests -v` — **passed**, 17 tests (`OK`) after audit changes. Covers simultaneous API checkout conflict, invalid dates, stable repeated return, re-checkout, history deletion constraints, restart persistence, repeat-safe seed, and fixed-date report expectations.
- `python3 .workflow/check.py acceptance` — **passed**. The acceptance checker independently ran all 17 tests and printed fixed-date seed/report totals and details (10 equipment, 4 borrowers, 5 loans; 7 available, 3 on loan; 3 active, 1 overdue, 2 returned; PT-001 / Maya Chen / 2026-10-15 / 7 days overdue), then repeated seed and report without changes.
- Read `lending/server.py`, `lending/schema.sql`, tests, `README.md`, `SPEC.md`, and `artifacts/integration.md`. Verified the checkout API conflict is exercised concurrently, uses `BEGIN IMMEDIATE` and a partial unique index; invalid dates are rejected at request and database levels; repeated return leaves the first date intact; referenced equipment/borrowers cannot be deleted; and a fresh server on the same database sees persisted records.

## Regression test added

Added `IntegrityTests.test_sqlite_rejects_impossible_due_and_return_dates` in `tests/test_foundation.py`. It directly verifies SQLite rejects impossible due and return calendar dates, with no loan row left behind. This adds coverage at the storage boundary to existing request-level checks.

## Defects and limitations

No application defect was established by the targeted audit, so no runtime behavior was changed. The added regression is test-only.

**Browser unavailable:** no interactive visual, keyboard, desktop/phone responsive, or integrated UI workflow check was performed during this audit. The integration note reports browser attachment timeouts; that is not evidence of passing browser inspection. Source-level accessibility and styling observations are not a substitute. This remains a limitation for later browser inspection.
