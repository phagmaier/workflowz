import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import type { HarnessRegistry } from "../adapters/harness-registry.js";
import type { Diagnostic, DiagnosticCode } from "../contracts/diagnostics.js";
import { parseWorkflowText } from "../contracts/parse-workflow.js";
import { INVALID_FIXTURES, OVERNIGHT_WORKFLOW, WARNING_FIXTURES } from "../test-support/paths.js";
import { compileOk, workflowText } from "../test-support/workflows.js";
import { checkWorkflowText } from "./check.js";
import { compileWorkflow } from "./compile.js";

/** Each invalid fixture must fail with the named code. A fixture without an entry fails the suite. */
const INVALID_EXPECTATIONS: Readonly<Record<string, DiagnosticCode>> = {
  "alias.yaml": "alias_not_allowed",
  "bad-retry.yaml": "invalid_field",
  "both-prompt-fields.yaml": "invalid_field",
  "command-undeclared-outcome.yaml": "undeclared_outcome",
  "conflicting-policies.yaml": "conflicting_policy",
  "duplicate-step-key.yaml": "duplicate_key",
  "empty-document.yaml": "empty_document",
  "end-with-transition.yaml": "unknown_field",
  "incomplete-transitions.yaml": "incomplete_transition",
  "missing-prompt.yaml": "invalid_field",
  "missing-start.yaml": "missing_field",
  "multiple-documents.yaml": "multiple_documents",
  "placeholder-in-name.yaml": "placeholder_not_allowed",
  "policy-outcome-not-declared.yaml": "unknown_outcome_in_policy",
  "report-reference-to-command.yaml": "invalid_placeholder_reference",
  "reserved-outcome.yaml": "reserved_outcome",
  "task-placeholder-without-tasks.yaml": "tasks_required",
  "task-steps-without-source.yaml": "tasks_required",
  "two-actions-in-transition.yaml": "invalid_field",
  "undeclared-outcome.yaml": "undeclared_outcome",
  "unknown-goto.yaml": "unknown_step",
  "unknown-harness.yaml": "unknown_harness",
  "unknown-placeholder.yaml": "unknown_placeholder",
  "unknown-policy-step.yaml": "unknown_step",
  "unknown-step-field.yaml": "unknown_field",
  "unknown-step-kind.yaml": "unknown_step_kind",
  "unknown-system-outcome.yaml": "unknown_transition_key",
  "unknown-top-level-field.yaml": "unknown_field",
  "unsupported-version.yaml": "unsupported_version",
  "yaml-syntax.yaml": "yaml_syntax",
};

const WARNING_EXPECTATIONS: Readonly<Record<string, DiagnosticCode>> = {
  "unbounded-loop-no-limits.yaml": "unbounded_cycle",
  "unreachable-step.yaml": "unreachable_step",
};

function errorsOf(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.severity === "error");
}

function checkFile(directory: string, name: string) {
  return checkWorkflowText(readFileSync(path.join(directory, name), "utf8"), {
    workflowDir: directory,
  });
}

describe("invalid workflow fixtures", () => {
  it("has an expectation for every fixture file and no stale expectations", () => {
    assert.deepEqual(
      readdirSync(INVALID_FIXTURES).sort(),
      Object.keys(INVALID_EXPECTATIONS).sort(),
    );
  });

  for (const [name, code] of Object.entries(INVALID_EXPECTATIONS)) {
    it(`${name} fails with ${code}`, () => {
      const result = checkFile(INVALID_FIXTURES, name);
      assert.equal(result.compiled, undefined, "an invalid workflow must not compile");
      const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
      assert.ok(
        errors.some((diagnostic) => diagnostic.code === code),
        `expected ${code}, got ${JSON.stringify(errors.map((diagnostic) => diagnostic.code))}`,
      );
      for (const diagnostic of errors) {
        if (diagnostic.code !== "empty_document") {
          assert.ok(diagnostic.location, `${diagnostic.code} should point at a source location`);
        }
      }
    });
  }
});

describe("warning-only fixtures", () => {
  for (const [name, code] of Object.entries(WARNING_EXPECTATIONS)) {
    it(`${name} compiles and warns with ${code}`, () => {
      const result = checkFile(WARNING_FIXTURES, name);
      assert.ok(result.compiled, JSON.stringify(result.diagnostics));
      assert.deepEqual(
        result.diagnostics.map((diagnostic) => diagnostic.code),
        [code],
      );
      assert.equal(result.diagnostics[0]?.severity, "warning");
    });
  }
});

describe("overnight example", () => {
  it("compiles with no diagnostics and resolves every outcome exactly", () => {
    const result = checkWorkflowText(readFileSync(OVERNIGHT_WORKFLOW, "utf8"), {
      workflowDir: path.dirname(OVERNIGHT_WORKFLOW),
    });
    assert.deepEqual(result.diagnostics, []);
    assert.ok(result.compiled);

    const table = Object.fromEntries(
      [...result.compiled.transitions].map(([step, row]) => [
        step,
        Object.fromEntries(
          [...row].map(([outcome, rule]) => [
            outcome,
            `${rule.action.kind}:${rule.action.kind === "goto" ? rule.action.target : ""}`,
          ]),
        ),
      ]),
    );
    assert.deepEqual(table, {
      pick_task: { task_ready: "goto:implement", exhausted: "goto:done" },
      implement: { complete: "goto:review", needs_debugging: "goto:debug", blocked: "pause:" },
      debug: { repaired: "goto:review", unable_to_fix: "pause:", blocked: "pause:" },
      review: { approved: "goto:git_add", revise: "goto:implement", blocked: "pause:" },
      git_add: { complete: "goto:commit", failed: "pause:" },
      commit: { complete: "goto:mark_done", failed: "pause:" },
      mark_done: { complete: "goto:pick_task" },
      done: {},
    });
  });

  it("resolves paths relative to the workflow file and keeps report/limit settings", () => {
    const result = checkWorkflowText(readFileSync(OVERNIGHT_WORKFLOW, "utf8"), {
      workflowDir: path.dirname(OVERNIGHT_WORKFLOW),
    });
    assert.equal(
      result.compiled?.projectRoot,
      path.resolve(path.dirname(OVERNIGHT_WORKFLOW), ".."),
    );
    assert.equal(
      result.compiled?.tasksSourcePath,
      path.resolve(path.dirname(OVERNIGHT_WORKFLOW), "..", "examples", "tasks.md"),
    );
    assert.equal(result.compiled?.limits.maxStepExecutions, 120);
    assert.equal(result.compiled?.reportCorrectionAttempts, 1);
  });
});

describe("compiler rules", () => {
  it("requires an explicit transition for an outcome named constructor", () => {
    const result = checkWorkflowText(
      workflowText(
        "start: a\nsteps:\n  a:\n    kind: agent\n    harness: codex\n    session: fresh\n    prompt: go\n    outcomes: [constructor]\n",
      ),
      { workflowDir: "/w" },
    );
    assert.equal(result.compiled, undefined);
    assert.deepEqual(
      result.diagnostics.map((diagnostic) => diagnostic.code),
      ["incomplete_transition"],
    );
  });

  it("rejects conflicting constructor policies instead of treating the prototype as an override", () => {
    const result = checkWorkflowText(
      workflowText(
        "policies:\n  - match: { all: true }\n    on:\n      constructor: { pause: true }\n  - match: { all: true }\n    on:\n      constructor: { goto: done }\nstart: a\nsteps:\n  a:\n    kind: agent\n    harness: codex\n    session: fresh\n    prompt: go\n    outcomes: [constructor]\n  done:\n    kind: end\n",
      ),
      { workflowDir: "/w" },
    );
    assert.equal(result.compiled, undefined);
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "conflicting_policy"));
  });

  it("does not resolve an undeclared constructor step through the object prototype", () => {
    const result = checkWorkflowText(
      workflowText(
        'start: a\nsteps:\n  a:\n    kind: agent\n    harness: codex\n    session: fresh\n    prompt: "{{reports.constructor.summary}}"\n    outcomes: [complete]\n    on:\n      complete: { pause: true }\n',
      ),
      { workflowDir: "/w" },
    );
    assert.equal(result.compiled, undefined);
    assert.deepEqual(
      result.diagnostics.map((diagnostic) => diagnostic.code),
      ["unknown_step"],
    );
  });

  it("follows step-local system routes when checking reachability and cycles", () => {
    for (const outcome of ["system.timeout", "system.error"]) {
      const result = checkWorkflowText(
        workflowText(
          `start: a\nsteps:\n  a:\n    kind: command\n    argv: [echo]\n    on:\n      complete: { pause: true }\n      failed: { pause: true }\n      ${outcome}: { goto: recovery }\n  recovery:\n    kind: command\n    argv: [echo]\n    on:\n      complete: { goto: a }\n      failed: { pause: true }\n`,
        ),
        { workflowDir: "/w" },
      );
      assert.ok(result.compiled);
      assert.deepEqual(
        result.diagnostics.map((diagnostic) => diagnostic.code),
        ["unbounded_cycle"],
      );
    }
  });

  it("does not invent outgoing error edges from terminal steps", () => {
    const result = checkWorkflowText(
      workflowText(
        "start: done\ndefaults:\n  on:\n    system.error: { goto: after }\nsteps:\n  done:\n    kind: end\n  after:\n    kind: end\n",
      ),
      { workflowDir: "/w" },
    );
    assert.ok(result.compiled);
    assert.deepEqual(
      result.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.path]),
      [["unreachable_step", ["steps", "after"]]],
    );
  });

  it("accepts a harness that exists only in a supplied registry, proving the registry is data", () => {
    const registry: HarnessRegistry = new Map([
      [
        "fake",
        {
          id: "fake",
          product: "Fake",
          binary: "fake",
          adapter: "planned",
          capabilities: {
            supportsResume: false,
            supportsEventStream: false,
            supportsStructuredFinalOutput: false,
            supportsPermissionMode: false,
            supportsModelSelection: false,
            supportsReasoningEffort: false,
          },
        },
      ],
    ]);
    const text = workflowText(
      "start: a\nsteps:\n  a:\n    kind: agent\n    harness: fake\n    session: fresh\n    prompt: go\n    outcomes: [complete]\n    on:\n      complete: { goto: b }\n  b:\n    kind: end\n",
    );
    const parsed = parseWorkflowText(text);
    assert.ok(parsed.document);
    assert.ok(
      compileWorkflow(parsed.document, { workflowDir: "/w", harnesses: registry }).compiled,
    );
  });

  it("refuses session resume, model and reasoning selection when the harness does not advertise them", () => {
    const registry: HarnessRegistry = new Map([
      [
        "bare",
        {
          id: "bare",
          product: "Bare",
          binary: "bare",
          adapter: "planned",
          capabilities: {
            supportsResume: false,
            supportsEventStream: true,
            supportsStructuredFinalOutput: false,
            supportsPermissionMode: false,
            supportsModelSelection: false,
            supportsReasoningEffort: false,
          },
        },
      ],
    ]);
    const parsed = parseWorkflowText(
      workflowText(
        "start: a\nsteps:\n  a:\n    kind: agent\n    harness: bare\n    model: m1\n    reasoning_effort: high\n    session: resume\n    prompt: go\n    outcomes: [complete]\n    on:\n      complete: { goto: b }\n  b:\n    kind: end\n",
      ),
    );
    assert.ok(parsed.document);
    const result = compileWorkflow(parsed.document, { workflowDir: "/w", harnesses: registry });
    assert.deepEqual(
      result.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.path.join(".")]),
      [
        ["unsupported_capability", "steps.a.session"],
        ["unsupported_capability", "steps.a.model"],
        ["unsupported_capability", "steps.a.reasoning_effort"],
      ],
    );
  });

  it("requires every declared outcome of a command step, including failed", () => {
    const text = workflowText(
      "start: a\nsteps:\n  a:\n    kind: command\n    argv: [echo]\n    on:\n      complete: { goto: b }\n  b:\n    kind: end\n",
    );
    assert.deepEqual(
      checkWorkflowText(text, { workflowDir: "/w" }).diagnostics.map(
        (diagnostic) => diagnostic.code,
      ),
      ["incomplete_transition"],
    );
  });

  it("accepts placeholders that name real agent, command, and task references", () => {
    const text = `version: 1
name: refs
project:
  root: "."
tasks:
  source:
    kind: markdown_checklist
    path: todo.md
start: pick
steps:
  pick:
    kind: task.next
    on:
      task_ready: { goto: build }
      exhausted: { goto: done }
  build:
    kind: agent
    harness: codex
    session: fresh
    prompt: "Do {{task.id}}: {{task.text}} after {{reports.build.summary}}"
    context:
      include_reports: [build]
    outcomes: [complete]
    on:
      complete: { goto: commit }
  commit:
    kind: command
    argv: [git, commit, -m, "{{task.index}} {{steps.commit.stdout}}"]
    on:
      complete: { goto: pick }
      failed: { pause: true }
  done:
    kind: end
`;
    const result = checkWorkflowText(text, { workflowDir: "/w" });
    assert.deepEqual(errorsOf(result.diagnostics), []);
  });

  it("rejects an include_reports entry that names a missing or non-agent step", () => {
    const text = workflowText(
      "start: a\nsteps:\n  a:\n    kind: agent\n    harness: codex\n    session: fresh\n    prompt: go\n    context:\n      include_reports: [ghost, b]\n    outcomes: [complete]\n    on:\n      complete: { goto: c }\n  b:\n    kind: command\n    argv: [echo]\n    on:\n      complete: { goto: c }\n      failed: { pause: true }\n  c:\n    kind: end\n",
    );
    assert.deepEqual(
      errorsOf(checkWorkflowText(text, { workflowDir: "/w" }).diagnostics).map((diagnostic) => [
        diagnostic.code,
        diagnostic.path.join("."),
      ]),
      [
        ["unknown_step", "steps.a.context.include_reports.0"],
        ["invalid_field", "steps.a.context.include_reports.1"],
      ],
    );
  });

  it("accepts retries and both report-correction settings, and records the chosen one", () => {
    for (const attempts of [0, 1]) {
      const text = workflowText(
        `defaults:\n  report_correction_attempts: ${attempts}\nstart: a\nsteps:\n  a:\n    kind: command\n    argv: [echo]\n    on:\n      complete: { goto: b }\n      failed: { retry: { max_attempts: 3, backoff_seconds: 5 } }\n  b:\n    kind: end\n`,
      );
      const compiled = compileOk(text);
      assert.equal(compiled.reportCorrectionAttempts, attempts);
      assert.deepEqual(compiled.transitions.get("a")?.get("failed")?.action, {
        kind: "retry",
        maxAttempts: 3,
        backoffSeconds: 5,
      });
    }
  });

  it("warns about a loop only when no execution limit bounds it", () => {
    const loop =
      "start: a\nsteps:\n  a:\n    kind: command\n    argv: [echo]\n    on:\n      complete: { goto: a }\n      failed: { pause: true }\n";
    assert.deepEqual(
      checkWorkflowText(workflowText(loop), { workflowDir: "/w" }).diagnostics.map(
        (diagnostic) => diagnostic.code,
      ),
      ["unbounded_cycle"],
    );
    assert.deepEqual(
      checkWorkflowText(workflowText(`limits:\n  max_step_executions: 10\n${loop}`), {
        workflowDir: "/w",
      }).diagnostics,
      [],
    );
  });
});
