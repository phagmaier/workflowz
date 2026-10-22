# Equipment lending implementation tasks

Workflowz imports these three unchecked tasks in source order. The foundation runs before
this loop. Do not tick these boxes to change runner state; completion is recorded by
Workflowz's `task.complete` step. Each slice should leave a runnable application.

- [ ] Equipment and borrower management
  Implement equipment and borrower CRUD through the server and browser, using SPEC.md's
  fields, validation and historical-reference deletion rules. Provide clear navigation,
  empty states, field feedback and keyboard-operable forms. Add meaningful tests for CRUD,
  trimming, missing fields, duplicate asset tags and deletion behavior. Update the README.

- [ ] Checkout, returns and loan history
  Implement checkout and return flows, active/returned loan listings and date validation.
  Enforce one active loan per item atomically, including repeated/concurrent requests.
  Preserve history and stable return dates. Make borrower/equipment selection and action
  outcomes clear in the UI. Add request-level and storage/business-rule regression tests.
  Verify persistence across a service restart and update usage instructions.

- [ ] Search, overdue visibility and deterministic reports
  Implement equipment search/category/availability combinations, loan filters, overview
  counts and overdue presentation. Complete the fixed-date seed and JSON report contracts.
  Add tests for overdue boundaries, report/database agreement, deterministic ordering and
  repeat-safe seeding. Polish responsive layout, keyboard focus and validation feedback
  across the existing flows. Record actual checks and any limitations in the README.
