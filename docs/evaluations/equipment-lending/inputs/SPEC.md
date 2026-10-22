# Workshop equipment lending

## Product

A small community workshop needs to know what equipment it owns, who has borrowed it,
and what is overdue. Build a local browser application for one workshop operator. Use
fictional names and data. The result should feel like a small usable application rather
than a backend demo or a form pasted onto an empty page.

## Technical envelope

Use Python's standard library for the server, SQLite persistence, and ordinary local
HTML/CSS/JavaScript. Use the installed Python runtime; no third-party runtime dependencies,
CDN assets, external APIs, authentication, deployment or build pipeline. Bind locally.
Keep source and generated runtime data inside this project. Choose a clear small
structure and document it; elaborate architecture is unnecessary.

Provide these stable commands, running from the project directory:

- `python3 -m lending serve --db PATH --host 127.0.0.1 --port PORT`
- `python3 -m lending seed --db PATH`
- `python3 -m lending report --db PATH --as-of YYYY-MM-DD --format json`
- `python3 -m unittest discover -s tests -v`

The service initializes a new database if needed. Seeding a nonempty database must not
erase or duplicate records. Tests use temporary databases and ephemeral local ports,
not the demo database. Generated data lives in `var/`; public check evidence in `artifacts/`.
Add project-local ignore entries for runtime data/cache files if useful; no Git workflow
or repository creation is needed.

## Data and behavior

**Equipment:** stable ID, name, unique asset tag, category and optional notes. All name,
tag and category fields are required after trimming. Each row represents one physical
item, not a quantity. Availability is derived from whether an active loan exists.

**Borrowers:** stable ID, display name, email and optional notes. Name and a plausibly
formed email are required; email need not be globally unique. Equipment and borrower
records can be created, listed, edited and deleted. Deleting an unused record succeeds.
Deleting a record referenced by any historical or active loan is refused with a clear
message so loan history retains its references.

**Loans:** equipment, borrower, checkout date, due date and nullable returned date.
Only existing records can be selected. At most one active loan can exist per item,
including concurrent/repeated checkout requests. Due date cannot precede checkout date.
Returning a loan records its return date, which cannot precede checkout date, preserves
history and makes the item available again. Repeated return requests must not rewrite
the recorded return date. Loan corrections/deletion are outside scope.

Dates are local calendar dates, stored as ISO dates. A loan is overdue when it is active
and its due date is strictly before the as-of date. Due today is not overdue. The UI can
use today's local date; reports and tests take an explicit as-of date.

Enforce rules on the server and through SQLite integrity/transaction behavior where
needed. Disabling a UI button alone does not establish correctness. Failed validation
and conflicts leave existing data intact.

## User experience

- Clear navigation between equipment, borrowers and loans; useful overview counts.
- Equipment search by name or tag, category filter and available/on-loan filter, which
  work together. Loans can be filtered to active, overdue or returned.
- Obvious checkout and return actions with selected equipment/borrower apparent.
- Clear empty states, field labels, inline validation, action progress and success/error
  feedback. Preserve entered values when an operation fails. Prevent accidental duplicate
  submissions. Confirm deletion with the record name visible.
- Keyboard-operable navigation, forms and actions, visible focus, readable contrast and
  responsive layouts usable on a phone and desktop. Do not rely on color alone for status.
- No network-loaded fonts or imagery. Use consistent spacing, type and status treatment.

## Seed and report

Seed at least 8 pieces of equipment in 3 categories, 4 borrowers and representative loan
history. Include at least 2 available items, 1 active overdue loan, 1 active loan due
today, 1 active future loan and 1 returned loan. Use dates around a documented fixed
demo date, **2026-10-22**, so independent reports are reproducible. Make it clear when
live UI overdue indicators differ because today's date is different.

The JSON report includes `as_of`, equipment counts (`total`, `available`, `on_loan`),
borrower count, loan counts (`active`, `overdue`, `returned`), and overdue loan details
including asset tag, borrower display name, due date and days overdue. Sort overdue
details deterministically by due date then asset tag. It must read real database
records, not hard-code seed totals. Errors go to stderr with a nonzero exit code.

## Acceptance evidence

1. Start from a clean database, seed it, and open a functioning local UI.
2. Create/edit/delete unused equipment and borrowers; required-field and duplicate-tag
   errors are understandable and preserve form input.
3. Check out an available item; a second checkout of that item is refused without a
   second active loan. Test the rule through the API/storage as well as the interface.
4. Reject invalid dates; distinguish overdue, due-today and returned cases correctly.
5. Return an item, preserve its history and check it out again. A repeated return does
   not alter the original historical return date.
6. Refuse deletion of equipment/borrowers referenced by loan history.
7. Search/filter combinations find the intended equipment and loans.
8. Restart the service against the same database and verify records persist.
9. Run automated tests in disposable state, including request-level integration tests
   and meaningful business-rule cases. No paid provider or external service is needed.
10. Generate the deterministic report, verify its totals/details against the database,
    and check repeated seed does not duplicate or erase data.
11. Inspect the UI with keyboard and at desktop and phone widths. Report any inspection
    that could not be performed instead of claiming it passed.
12. README documents exact launch, seed, test and report commands, limitations and data paths.

Maintenance state is a later change, not part of this baseline. No user login, multi-tenant
permissions, reservations, notification delivery, payment, file upload or deployment is required.
