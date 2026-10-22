# Authorized maintenance delta

The baseline has passed independent API/process checks and actual browser CRUD. Add the
planned small maintenance-state feature now. This is a later revision, intentionally
superseding SPEC.md's baseline-only maintenance deferral. Preserve all other requirements.

- Equipment can be marked as under maintenance and cleared again through the browser.
- An item under maintenance is unavailable for new checkout, enforced on the server and
  at the transaction/storage boundary. Concurrent checkout/state changes must not bypass it.
- Existing loans remain returnable, including when the item is marked under maintenance
  while on loan. Returning it does not clear maintenance or make it lendable.
- Equipment search/availability filters, checkout choices, overview and JSON reporting
  reflect maintenance. Keep existing report fields; add a clearly documented maintenance
  count. Define overlapping on-loan/maintenance counts explicitly and consistently.
- Existing databases migrate without losing IDs, records or loan history; old rows default
  to no maintenance. Repeat initialization/seeding remains safe. Ordinary edits and omitted
  maintenance input must not accidentally clear an existing flag. Reject malformed values.
- Add meaningful request/storage tests, old-schema migration coverage and a real Chromium
  interaction regression at scripts/maintenance-regression.mjs. Keep the previously added
  scripts/browser-regression.mjs passing. No third-party application runtime dependency.

Choose ordinary API/UI details autonomously. Keep the change small and usable, preserve
all original inputs/checklists, and record actual evidence/limits in artifacts/maintenance.md.
Browser recipe: ancestor @playwright/test is installed; chromium.launch({channel:'chromium',
headless:true}) works without attachment or installation. Use disposable DBs, ephemeral
localhost ports and settle every owned server/browser before reporting.
