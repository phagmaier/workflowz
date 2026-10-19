/** Shared locations for tests. Compiled tests live in dist/, so paths are anchored to the repo root. */
import path from "node:path";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
export const OVERNIGHT_WORKFLOW = path.join(REPO_ROOT, "examples", "overnight.yaml");
export const INVALID_FIXTURES = path.join(REPO_ROOT, "test", "fixtures", "workflows", "invalid");
export const WARNING_FIXTURES = path.join(REPO_ROOT, "test", "fixtures", "workflows", "warnings");
