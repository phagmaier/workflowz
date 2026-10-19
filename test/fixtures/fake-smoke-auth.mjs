// Synthetic status only. No auth files, refresh, login or providers.
import assert from "node:assert/strict";

const [harness, code, ...args] = process.argv.slice(2);
assert.deepEqual(
  args,
  harness === "codex"
    ? ["login", "status"]
    : harness === "claude"
      ? ["auth", "status"]
      : ["auth", "check", "--model", "openai/synthetic", "--no-refresh"],
);
assert.equal(process.env.UNSELECTED_SECRET, undefined);
process.stdout.write("synthetic account payload must not be retained\n");
process.stderr.write("synthetic auth diagnostic must not be retained\n");
process.exit(Number(code));
