# Task 1 — Equipment and borrower management

Date: 2026-10-22

## Delivered

- Added JSON collection and mutation endpoints for equipment and borrowers.
- Required values are trimmed and checked on the server. Borrower email gets a basic plausible-address check; duplicate asset tags return a conflict. Failed writes do not change the existing rows.
- Equipment lists derive availability from active loans. Deletes of any loan-referenced record are rejected by SQLite foreign keys and returned as a clear conflict. Unused records can be deleted.
- Replaced the placeholder equipment and borrower panels with navigation links, labelled forms, record lists, edit and confirmed delete actions, empty states, inline error/success feedback, and a disabled-while-saving submit button.
- README now documents the current slice, API and scope limitations.

## Checks actually run

- `python3 -m unittest discover -s tests -v` — **passed**, 12 tests after review fixes. The HTTP integration test exercises create/list/edit/delete for both record types, whitespace trimming, missing required fields, invalid email, case-insensitive duplicate tags, preservation after failed writes, null values, non-string values, and deletion of unused versus loan-referenced records.
- `python3 -m compileall -q lending tests` — **passed**.
- Chromium headless renders of a seeded empty-database overview at 390×1800 and 1440×1500 — both generated: `task-1-phone.png` and `task-1-desktop.png`. The phone capture was visually inspected; the layout uses a single management column and no horizontal overflow was apparent in the captured viewport.

## Limitations and handoff

- Checkout/return workflows, equipment search and filters, loan filtering, and the full overdue detail list remain later slices.
- Keyboard operation was not exercised interactively; visible focus styling and semantic form controls are present in source, but should receive an interactive browser check.
- Email validation intentionally checks common address shape only; there is no email delivery or global uniqueness requirement.
- The service was run against `/tmp/equipment-lending-visual.sqlite`, not the demo database, and was stopped before handoff.

## Review finding and correction

The supplied review reproduced that `_validated_record` applied `str()` directly to JSON values. This made JSON `null` become the literal string `"None"`; a null required name therefore passed validation, and a null optional note was stored as text. Numbers and other JSON types were also silently coerced.

The validator now treats `null` as missing (so required fields get their normal required-field error and optional notes become SQL `NULL`) and rejects non-string types with a field-specific text error. Regression assertions cover null and numeric values for equipment and borrowers, and explicitly verify a null borrower note is stored as SQL `NULL`.

Checks for this review turn:

- Initial `python3 -m unittest discover -s tests -v` — **failed** after adding another test borrower, because the existing integration test assumed the seeded Maya record would always have ID 1. This was test coupling, not an application failure; the assertion now queries the fixture by stable name/tag instead of assuming IDs.
- Final `python3 -m unittest discover -s tests -v` — **passed**, 12 tests (`OK`). The null/non-string API requests returned 400, and the null optional note persisted as SQL `NULL`.
