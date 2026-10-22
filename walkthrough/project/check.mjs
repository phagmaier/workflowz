import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const mode = process.argv[2];
assert.ok(["before", "after", "finish"].includes(mode), "Use before, after or finish");
assert.equal(
  readFileSync("greeting.txt", "utf8"),
  mode === "before" ? "Hello from Workflowz.\n" : "Hello from Workflowz and OpenCode.\n",
  "Unexpected greeting.txt contents",
);
assert.equal(existsSync("receipt.txt"), false, "Receipt already exists; use a fresh project");
if (mode === "finish") {
  writeFileSync("receipt.txt", "Owner resumed; greeting verified.\n", { flag: "wx" });
  console.log("FINISH OK — receipt.txt created after explicit Resume");
} else {
  console.log(
    mode === "before" ? "BASELINE OK — original greeting" : "CHANGE OK — owner checkpoint",
  );
}
