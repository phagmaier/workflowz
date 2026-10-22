# Review 1 — Equipment and borrower management

Outcome: **changes**

## Findings

1. **Null optional/required fields are stored as the string "None"** (blocking for notes, correctness for names).
   - Location: `lending/server.py`, `_validated_record` (`str(payload.get(key, "")).strip()`).
   - Reproduce: `POST /api/equipment` with `{"name": null, "asset_tag": "X-1", "category": "C", "notes": null}`.
   - Expected: 400 "Enter an equipment name." for null name; `notes` stored as NULL for null notes.
   - Actual: 201; list returns `name: "None"` and `notes: "None"`.
   - Same path affects borrowers (`name`, `email`, `notes`).
   - Fix direction: treat `None` as missing before `str()` (e.g. `payload.get(key) or ""` after type check, or reject non-string values).

2. **Non-string values are coerced silently** (minor).
   - `{"email": 12}` is coerced to `"12"` and then rejected by the email check, so the outcome is correct by accident; `{"name": 5}` would be accepted as `"5"`. Reject non-string JSON types explicitly.

## Executed checks

- `python3 -m unittest discover -s tests -v` — 12 tests, OK.
- `python3 -m compileall -q lending tests` — OK.
- Temporary-DB probe via `create_server` on an ephemeral port (server shut down afterward):
  - missing name → 400; duplicate tag `x-1` vs `X-1` → 409; unknown id PUT → 404; invalid email → 400: all as specified.
  - null name/notes → 201 (finding 1).

## Not verified

- Browser keyboard operation, focus visibility and phone/desktop layout were not exercised interactively in this review; the author's PNG captures were not re-inspected.
- Trimming, referenced-record delete conflict and update-path tests were confirmed by reading `tests/test_foundation.py` (`test_equipment_and_borrower_crud_validation_and_history_conflicts`), not by a separate run.
- The delete flow in `lending/web/app.js:91` shows record name (and asset tag) in `confirm`, and disables the button while pending; the HTTP delete conflict path is covered by the test suite.

## Handoff

Fix finding 1 in `_validated_record` and add a test that posts null name/notes and expects a 400 for null name and NULL notes for null notes. Then re-run the unittest command.
