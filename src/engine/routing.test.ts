import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileOk, workflowText } from "../test-support/workflows.js";
import type { CompiledWorkflow } from "./model.js";
import { resolveOutcome } from "./routing.js";

/** Declared normal outcomes of a step, as the runner will pass them to resolveOutcome. */
function declared(workflow: CompiledWorkflow, stepId: string): Set<string> {
  return new Set(workflow.steps.get(stepId)?.outcomes ?? []);
}

/** Policy blocks in written order; the policy-order test reverses them. */
const POLICY_BLOCKS = [
  `  - match: { all: true }
    on:
      needs_fix: { goto: all_target }
      system.spawn_error: { goto: all_target }
`,
  `  - match: { tags: [impl] }
    on:
      needs_fix: { goto: tag_target }
`,
  `  - match: { step_ids: [a] }
    on:
      needs_fix: { goto: id_target }
`,
];

function precedenceWorkflow(policyBlocks: readonly string[]): string {
  return workflowText(`defaults:
  on:
    complete: { goto: fallback }
    system.error: { pause: true }
    system.timeout: { goto: fallback }
policies:
${policyBlocks.join("")}start: a
steps:
  a:
    kind: agent
    harness: codex
    session: fresh
    prompt: go
    tags: [impl]
    outcomes: [complete, needs_fix, blocked]
    on:
      complete: { goto: end_ok }
      blocked: { pause: true }
  c:
    kind: agent
    harness: codex
    session: fresh
    prompt: go
    tags: [impl]
    outcomes: [needs_fix, complete]
  d:
    kind: agent
    harness: codex
    session: fresh
    prompt: go
    outcomes: [needs_fix]
  end_ok:
    kind: end
  fallback:
    kind: end
  all_target:
    kind: end
  tag_target:
    kind: end
  id_target:
    kind: end
`);
}

const PRECEDENCE = precedenceWorkflow(POLICY_BLOCKS);

describe("outcome routing precedence", () => {
  it("treats constructor as an ordinary outcome at every precedence level", () => {
    const agent =
      "start: a\nsteps:\n  a:\n    kind: agent\n    harness: codex\n    session: fresh\n    prompt: go\n    tags: [t]\n    outcomes: [constructor]\n";
    const cases = [
      ["step", `${agent}    on:\n      constructor: { pause: true }\n`],
      [
        "step_id_policy",
        `policies:\n  - match: { step_ids: [a] }\n    on:\n      constructor: { pause: true }\n${agent}`,
      ],
      [
        "tag_policy",
        `policies:\n  - match: { tags: [t] }\n    on:\n      constructor: { pause: true }\n${agent}`,
      ],
      [
        "all_policy",
        `policies:\n  - match: { all: true }\n    on:\n      constructor: { pause: true }\n${agent}`,
      ],
      ["defaults", `defaults:\n  on:\n    constructor: { pause: true }\n${agent}`],
    ] as const;
    for (const [level, body] of cases) {
      const compiled = compileOk(workflowText(body));
      const rule = resolveOutcome(compiled, "a", "constructor", declared(compiled, "a"));
      assert.deepEqual(rule.action, { kind: "pause" });
      assert.equal(rule.source.level, level);
    }
  });

  const workflow = compileOk(PRECEDENCE);

  it("prefers the step's own transition over every policy and default", () => {
    const rule = resolveOutcome(workflow, "a", "complete", declared(workflow, "a"));
    assert.deepEqual(rule.action, { kind: "goto", target: "end_ok" });
    assert.deepEqual(rule.source, { level: "step" });
  });

  it("prefers a step-ID policy over a tag policy and an all-steps policy", () => {
    const rule = resolveOutcome(workflow, "a", "needs_fix", declared(workflow, "a"));
    assert.deepEqual(rule.action, { kind: "goto", target: "id_target" });
    assert.deepEqual(rule.source, { level: "step_id_policy", policyIndex: 2 });
  });

  it("prefers a tag policy over an all-steps policy", () => {
    const rule = resolveOutcome(workflow, "c", "needs_fix", declared(workflow, "c"));
    assert.deepEqual(rule.action, { kind: "goto", target: "tag_target" });
    assert.deepEqual(rule.source, { level: "tag_policy", policyIndex: 1 });
  });

  it("falls back to an all-steps policy when no narrower rule applies", () => {
    const rule = resolveOutcome(workflow, "d", "needs_fix", declared(workflow, "d"));
    assert.deepEqual(rule.action, { kind: "goto", target: "all_target" });
    assert.deepEqual(rule.source, { level: "all_policy", policyIndex: 0 });
  });

  it("uses defaults.on when nothing more specific matches", () => {
    const rule = resolveOutcome(workflow, "c", "complete", declared(workflow, "c"));
    assert.deepEqual(rule.action, { kind: "goto", target: "fallback" });
    assert.deepEqual(rule.source, { level: "defaults" });
  });

  it("refuses to route an outcome the step does not declare", () => {
    assert.throws(
      () => resolveOutcome(workflow, "a", "unknown_result", declared(workflow, "a")),
      TypeError,
    );
    assert.throws(
      () => resolveOutcome(workflow, "a", "system.error_typo", declared(workflow, "a")),
      /unknown|reserved|system/,
    );
  });
});

describe("system outcome routing", () => {
  const workflow = compileOk(PRECEDENCE);

  it("uses an exact system rule when one exists", () => {
    const rule = resolveOutcome(workflow, "d", "system.spawn_error", declared(workflow, "d"));
    assert.deepEqual(rule.action, { kind: "goto", target: "all_target" });
    assert.equal(rule.viaSystemError, false);
  });

  it("falls back to system.error when no exact system rule exists", () => {
    const rule = resolveOutcome(workflow, "d", "system.report_error", declared(workflow, "d"));
    assert.deepEqual(rule.action, { kind: "pause" });
    assert.deepEqual(rule.source, { level: "defaults" });
    assert.equal(rule.viaSystemError, true);
    assert.equal(rule.outcome, "system.report_error");
  });

  it("pauses when no rule at all matches, so an engine error is never accepted", () => {
    const bare = compileOk(
      workflowText(
        "start: a\nsteps:\n  a:\n    kind: command\n    argv: [echo]\n    on:\n      complete: { goto: b }\n      failed: { pause: true }\n  b:\n    kind: end\n",
      ),
    );
    const rule = resolveOutcome(bare, "a", "system.timeout", declared(bare, "a"));
    assert.deepEqual(rule.action, { kind: "pause" });
    assert.deepEqual(rule.source, { level: "built_in_pause" });
  });
});

describe("policy compilation", () => {
  it("gives the same routing regardless of the order policies are written in", () => {
    const original = compileOk(PRECEDENCE);
    const flipped = compileOk(precedenceWorkflow([...POLICY_BLOCKS].reverse()));
    for (const [stepId, row] of original.transitions) {
      for (const [outcome, rule] of row) {
        assert.deepEqual(
          flipped.transitions.get(stepId)?.get(outcome)?.action,
          rule.action,
          `${stepId}.${outcome}`,
        );
      }
    }
  });

  it("accepts two policies of the same level that agree", () => {
    const text = workflowText(
      "policies:\n  - match: { tags: [t] }\n    on:\n      failed: { pause: true }\n  - match: { tags: [t] }\n    on:\n      failed: { pause: true }\nstart: a\nsteps:\n  a:\n    kind: command\n    argv: [echo]\n    tags: [t]\n    on:\n      complete: { goto: b }\n  b:\n    kind: end\n",
    );
    assert.deepEqual(compileOk(text).policies.length, 2);
  });
});
