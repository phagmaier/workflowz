// Visual edits are checked by the real browser `draft` operation, so routes and problems come
// from the daemon's compiler rather than hand-written fixtures.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type * as Browser from "../../../src/app/browser-service.ts";
import type * as Management from "../../../src/app/management-service.ts";
import type * as Database from "../../../src/store/database.ts";
import { editorHref, parseRoute } from "../route.ts";
import type { BrowserDraft, SavedWorkflow } from "../types.ts";
import {
  addOutcome,
  addStep,
  type Doc,
  describeAction,
  destinationOptions,
  exampleDoc,
  groupWorkflows,
  moveStep,
  outcomeRows,
  problems,
  removeStep,
  renameStep,
  routeLines,
  setRule,
  sourceLabel,
  stepIdFor,
  stepSummary,
} from "./workflow-edit.ts";

const dist = (file: string) => new URL(`../../../dist/${file}`, import.meta.url).href;
const { ManagementService } = (await import(
  dist("app/management-service.js")
)) as typeof Management;
const { BrowserService } = (await import(dist("app/browser-service.js"))) as typeof Browser;
const { WorkflowDatabase } = (await import(dist("store/database.js"))) as typeof Database;

let root: string;
let database: InstanceType<typeof WorkflowDatabase>;
let management: InstanceType<typeof ManagementService>;
let browser: InstanceType<typeof BrowserService>;
const draft = async (model: Doc) =>
  (await browser.handle({
    op: "draft",
    workflowDir: root,
    workflowText: "",
    model,
  })) as BrowserDraft;

before(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "wf-ui-edit-"));
  writeFileSync(path.join(root, "tasks.md"), "- [ ] First\n- [x] Done already\n");
  database = new WorkflowDatabase(":memory:");
  management = new ManagementService(database, path.join(root, "logs"), new Map());
  browser = new BrowserService(management);
});
after(async () => {
  await management.shutdown();
  database.close();
  rmSync(root, { recursive: true, force: true });
});

describe("visual workflow edits checked by the daemon", () => {
  it("starts every example as a valid draft", async () => {
    for (const example of ["single", "loop", "commands"] as const) {
      const doc = exampleDoc(example, `Example ${example}`, root, "tasks.md");
      const result = await draft(doc);
      assert.equal(result.valid, true, `${example}: ${JSON.stringify(result.diagnostics)}`);
      assert.deepEqual(problems(result.diagnostics, doc), []);
      assert.equal(result.projectRoot, root);
    }
  });

  it("explains an unconnected result in context and resolves it when a destination is chosen", async () => {
    const start = exampleDoc("single", "Fix", root);
    const added = addOutcome(start, "work", "needs info");
    assert.ok(typeof added !== "string");
    const result = await draft(added);
    assert.equal(result.valid, false);
    const rows = outcomeRows(added, result, "work");
    assert.deepEqual(
      rows.map((r) => [r.outcome, r.missing]),
      [
        ["complete", false],
        ["blocked", false],
        ["needs_info", true],
      ],
    );
    const [problem] = problems(result.diagnostics, added);
    assert.equal(problem?.text, "Work: choose what happens after “needs_info”.");
    assert.deepEqual([problem?.stepId, problem?.outcome], ["work", "needs_info"]);
    assert.deepEqual(routeLines(added, result, "work"), [
      "complete → Finish (Done)",
      "blocked → Pause and wait for me",
      "needs_info → not chosen yet",
    ]);

    const fixed = setRule(added, "work", "needs_info", { pause: true });
    const ok = await draft(fixed);
    assert.equal(ok.valid, true);
    assert.equal(outcomeRows(fixed, ok, "work")[2]?.effective?.action.kind, "pause");
    assert.equal(
      addOutcome(fixed, "work", "needs_info"),
      "“needs_info” is already an outcome of this step.",
    );
    assert.match(String(addOutcome(fixed, "work", "system.x")), /reserved/);
  });

  it("keeps working when a new step makes the document unreadable to the compiler", async () => {
    const { doc, id } = addStep(exampleDoc("single", "Fix", root), "agent", "Write tests", "work");
    assert.equal(id, "write_tests");
    assert.deepEqual(Object.keys(doc.steps), ["work", "write_tests", "done"]);
    const result = await draft(doc);
    assert.equal(result.document, null, "an empty prompt fails shape validation");
    const listed = problems(result.diagnostics, doc);
    assert.deepEqual(
      listed.map((p) => [p.text, p.field]),
      [["Write tests: write a prompt.", "prompt"]],
    );
    // Without compiled routes, a result nothing mentions is still known to be unconnected.
    assert.deepEqual(
      outcomeRows(doc, result, id).map((r) => [r.outcome, r.missing]),
      [
        ["complete", true],
        ["blocked", false],
      ],
    );
    assert.equal(stepSummary(doc.steps[id] as never), "Codex — no prompt yet.");
  });

  it("shows where inherited rules come from", async () => {
    const doc: Doc = {
      ...exampleDoc("single", "Fix", root),
      defaults: { on: { blocked: { pause: true } } },
      policies: [
        {
          match: { all: true },
          on: { "system.timeout": { retry: { max_attempts: 3, backoff_seconds: 5 } } },
        },
      ],
    };
    const shared = setRule(doc, "work", "blocked", null);
    const result = await draft(shared);
    assert.equal(result.valid, true);
    const blocked = outcomeRows(shared, result, "work")[1];
    assert.equal(blocked?.own, undefined);
    assert.equal(blocked?.missing, false);
    assert.equal(
      sourceLabel(shared, blocked?.effective?.source ?? { level: "step" }),
      "From the workflow defaults",
    );
    const timeout = outcomeRows(shared, result, "work", true).find(
      (r) => r.outcome === "system.timeout",
    );
    assert.equal(
      sourceLabel(shared, timeout?.effective?.source ?? { level: "step" }),
      "From shared rule 1 (all steps)",
    );
    assert.equal(
      describeAction(shared, timeout?.effective?.action ?? { kind: "pause" }),
      "Retry this step (up to 3 runs, 5 s apart)",
    );
    const report = outcomeRows(shared, result, "work", true).find(
      (r) => r.outcome === "system.report_error",
    );
    assert.equal(report?.effective?.source.level, "built_in_pause");
  });

  it("offers direct destinations, including a Finish step that doesn't exist yet", () => {
    const doc = removeStep(exampleDoc("commands", "Build", root), "done");
    const labels = destinationOptions(doc, "run_tests", null).map((o) => `${o.group}:${o.label}`);
    assert.deepEqual(labels, [
      "Continue:Go to Run tests (this step again)",
      "Finish:Finish",
      "Other:Pause and wait for me",
      "Other:Retry this step",
      "Other:＋ New step…",
    ]);
    assert.equal(destinationOptions(doc, "run_tests", null, true).at(-1)?.label, "Retry this step");
  });

  it("explains references left behind by a deleted step instead of repairing them", async () => {
    const doc = removeStep(exampleDoc("single", "Fix", root), "done");
    const result = await draft(doc);
    assert.deepEqual(
      problems(result.diagnostics, doc).map((p) => p.text),
      ["Work: “complete” goes to a step that doesn't exist (“done”)."],
    );
  });

  it("renames a step and every structural reference to it", async () => {
    const base = exampleDoc("loop", "Loop", root, "tasks.md");
    const withPolicy: Doc = {
      ...base,
      policies: [{ match: { step_ids: ["implement"] }, on: { blocked: { pause: true } } }],
    };
    const renamed = renameStep(withPolicy, "implement", "Write code");
    assert.ok(typeof renamed !== "string");
    assert.equal(renamed.id, "write_code");
    assert.deepEqual(Object.keys(renamed.doc.steps), [
      "pick_task",
      "write_code",
      "mark_done",
      "done",
    ]);
    assert.deepEqual(renamed.doc.steps.pick_task, {
      kind: "task.next",
      on: { task_ready: { goto: "write_code" }, exhausted: { goto: "done" } },
    });
    assert.deepEqual(renamed.doc.policies?.[0]?.match, { step_ids: ["write_code"] });
    assert.equal((await draft(renamed.doc)).valid, true);
    const first = renameStep(base, "pick_task", "Choose");
    assert.ok(typeof first !== "string");
    assert.equal(first.doc.start, "choose");
    assert.equal(renameStep(base, "done", "  "), "Type a name for the step.");
  });

  it("names and orders steps predictably", () => {
    const doc = exampleDoc("single", "Fix", root);
    assert.equal(stepIdFor(doc, "Work"), "work_2");
    assert.equal(stepIdFor(doc, "  Run the 2nd test! "), "run_the_2nd_test");
    assert.equal(stepIdFor(doc, "42"), "step_42");
    assert.equal(stepIdFor(doc, "", "task.next"), "task_next");
    assert.deepEqual(Object.keys(moveStep(doc, "done", -1).steps), ["done", "work"]);
    assert.equal(moveStep(doc, "work", -1), doc);
  });
});

describe("saved workflows and editor routes", () => {
  it("groups immutable revisions by name, newest first, with their runs", () => {
    const saved: SavedWorkflow[] = [
      { revisionId: 1, name: "A", sourceDir: "/p", sha256: "a" },
      { revisionId: 2, name: "B", sourceDir: "/p", sha256: "b" },
      { revisionId: 3, name: "A", sourceDir: "/q", sha256: "c" },
    ];
    const groups = groupWorkflows(
      saved,
      new Map([
        [1, 2],
        [3, 1],
      ]),
    );
    assert.deepEqual(
      groups.map((g) => [g.name, g.latest.revisionId, g.older.map((r) => r.revisionId), g.runs]),
      [
        ["A", 3, [1], 3],
        ["B", 2, [], 0],
      ],
    );
  });

  it("parses and builds editor addresses", () => {
    assert.deepEqual(parseRoute("#/workflows/new"), { view: "new-workflow", example: null });
    assert.deepEqual(parseRoute("#/workflows/new/loop"), { view: "new-workflow", example: "loop" });
    assert.equal(parseRoute("#/workflows/new/other").view, "missing");
    assert.deepEqual(parseRoute("#/workflows/12/project"), {
      view: "editor",
      target: { kind: "revision", revisionId: 12 },
      tab: "project",
    });
    assert.deepEqual(parseRoute("#/workflows/draft/3"), {
      view: "editor",
      target: { kind: "draft", key: "draft:3" },
      tab: "steps",
    });
    assert.deepEqual(parseRoute("#/runs/run_1/edit/map"), {
      view: "editor",
      target: { kind: "run", runId: "run_1" },
      tab: "map",
    });
    for (const bad of [
      "#/workflows/0",
      "#/workflows/12/steps",
      "#/runs/r/edit/x",
      "#/workflows/draft/x",
    ])
      assert.equal(parseRoute(bad).view, "missing", bad);
    assert.equal(editorHref({ kind: "run", runId: "run 1" }, "yaml"), "#/runs/run%201/edit/yaml");
    assert.equal(editorHref({ kind: "draft", key: "draft:4" }), "#/workflows/draft/4");
  });
});
