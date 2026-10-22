import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyEffortDefaults,
  readEffortPreferences,
  rememberEffort,
} from "./effort-preferences.ts";
import { addStep, exampleDoc } from "./workflow-edit.ts";

test("effort preferences tolerate damaged storage, retain known harnesses and bound recent values", () => {
  for (const text of [null, "{", "null", "false", "12", '"text"']) {
    assert.deepEqual(readEffortPreferences(text), { defaults: {}, recent: {} });
  }
  const prefs = readEffortPreferences(
    JSON.stringify({
      defaults: { codex: "high", unknown: "value", claude: null },
      recent: {
        codex: [
          null,
          "custom",
          "custom",
          "",
          ...Array.from({ length: 20 }, (_, i) => `effort-${i}`),
        ],
        pi: "invalid",
      },
    }),
  );
  assert.deepEqual(prefs.defaults, { codex: "high" });
  assert.equal(prefs.recent.codex?.length, 12);
  assert.equal(prefs.recent.codex?.[0], "custom");
  const next = rememberEffort(prefs, "codex", " effort-2 ");
  assert.equal(next.recent.codex?.[0], "effort-2");
  assert.equal(next.recent.codex?.filter((v) => v === "effort-2").length, 1);
  assert.equal(rememberEffort(prefs, "unknown", "high"), prefs);
});

test("effort preferences apply only to newly created agents and preserve explicit workflow values", () => {
  const original = exampleDoc("single", "Effort", "/tmp");
  const prefs = { defaults: { codex: "custom-value", claude: "high" }, recent: {} };
  const added = addStep(original, "agent", "New agent", "work");
  const next = applyEffortDefaults(added.doc, prefs, [added.id]);
  const newAgent = next.steps[added.id];
  assert.ok(newAgent?.kind === "agent");
  assert.equal(newAgent.reasoning_effort, "custom-value");
  assert.deepEqual(next.steps.work, original.steps.work);
  assert.notDeepEqual(next.steps[added.id], added.doc.steps[added.id]);
  const work = original.steps.work;
  assert.ok(work?.kind === "agent");
  work.reasoning_effort = "existing-model-variant";
  assert.deepEqual(applyEffortDefaults(original, prefs).steps.work, work);
  assert.deepEqual(applyEffortDefaults(original, { defaults: {}, recent: {} }), original);
});
