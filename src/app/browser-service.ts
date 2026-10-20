/** Drafts and a narrow execution allowlist delegate all run authority to management. */
import { parseDocument, stringify } from "yaml";
import type { BrowserRequest, BrowserSource } from "../contracts/browser.js";
import type { Diagnostic } from "../contracts/diagnostics.js";
import { SYSTEM_OUTCOMES } from "../contracts/identifiers.js";
import { parseWorkflowText } from "../contracts/parse-workflow.js";
import type { TaskState } from "../contracts/run-state.js";
import type { WorkflowDocument } from "../contracts/workflow-schema.js";
import { checkWorkflowText } from "../engine/check.js";
import type { ResolvedTransition } from "../engine/model.js";
import { resolveOutcome } from "../engine/routing.js";
import { revisionCursor } from "../engine/run-configuration.js";
import { RunStateError, WorkflowInvalidError } from "../engine/run-coordinator.js";
import type { ManagementService } from "./management-service.js";
import { inspectWorkflow, validateWorkflow } from "./workflow-validation.js";

export interface BrowserDraft {
  workflowText: string;
  workflowDir: string;
  document: WorkflowDocument | null;
  valid: boolean;
  diagnostics: readonly Diagnostic[];
  projectRoot: string | null;
  transitions: Record<string, readonly ResolvedTransition[]>;
  systemOutcomes: readonly string[];
}
export interface BrowserRunEdit {
  runId: string;
  revisionId: number;
  expectedEventId: number;
  workflowText: string;
  workflowDir: string;
  cursorStepId: string;
  activeTaskId: string | null;
  steps: {
    stepId: string;
    kind: string;
    outcomes: string[];
    compatible: boolean;
    transitions: Record<string, string>;
  }[];
  tasks: { taskId: string; title: string; state: TaskState }[];
}
export class BrowserService {
  constructor(private readonly management: ManagementService) {}

  private source(source: BrowserSource) {
    if ("revisionId" in source) {
      const revision = this.management.store.getRevision(source.revisionId);
      return { workflowText: revision.definitionYaml, workflowDir: revision.sourceDir };
    }
    return source;
  }
  private paused(runId: string, expectedEventId: number) {
    const run = this.management.service.coordinator.run(runId);
    if (this.management.store.latestEventId(runId) !== expectedEventId)
      throw new RunStateError("stale control request; inspect status and use its expectedEventId");
    if (run.status !== "paused")
      throw new RunStateError(`run ${runId} is ${run.status}; browser editing requires paused`);
    if (this.management.store.activeAttempt(runId))
      throw new RunStateError(
        "browser editing requires no active attempt; settle or reconcile it first",
      );
    const pending = this.management.store.pendingRecovery();
    if (pending)
      throw new RunStateError(`run ${pending.runId} has an unresolved process; reconcile it first`);
    return run;
  }

  async handle(request: BrowserRequest): Promise<unknown> {
    if (request.op === "run-edit") {
      const run = this.paused(request.runId, request.expectedEventId);
      const coordinator = this.management.service.coordinator;
      const workflow = coordinator.workflowForCurrentTask(request.runId);
      const revision = this.management.store.getRevision(run.revisionId);
      return {
        runId: run.runId,
        revisionId: run.revisionId,
        expectedEventId: request.expectedEventId,
        workflowText: revision.definitionYaml,
        workflowDir: revision.sourceDir,
        cursorStepId: run.cursorStepId,
        activeTaskId: run.activeTaskId,
        steps: [...workflow.steps.values()].map((step) => {
          let compatible = true;
          try {
            revisionCursor(workflow, workflow, run.cursorStepId, run.activeTaskId, step.id);
          } catch {
            compatible = false;
          }
          const declared = new Set(step.outcomes);
          const transitions: Record<string, string> = Object.create(null);
          for (const outcome of step.outcomes)
            transitions[outcome] = JSON.stringify(
              resolveOutcome(workflow, step.id, outcome, declared).action,
            );
          return {
            stepId: step.id,
            kind: step.kind,
            outcomes: [...step.outcomes],
            compatible,
            transitions,
          };
        }),
        tasks: coordinator.tasks(request.runId).map(({ taskId, title, state }) => ({
          taskId,
          title,
          state,
        })),
      } satisfies BrowserRunEdit;
    }
    if (request.op === "revise" || request.op === "override") {
      this.paused(request.runId, request.expectedEventId);
      return this.management.handle(request);
    }
    if (request.op === "draft") {
      if (request.run) {
        const run = this.paused(request.run.runId, request.run.expectedEventId);
        const revision = this.management.store.getRevision(run.revisionId);
        if (request.workflowDir !== revision.sourceDir)
          throw new RunStateError("run drafts must retain the revision workflowDir");
      }
      const workflowText =
        request.model === undefined ? request.workflowText : stringify(request.model);
      if (workflowText.length > 1024 * 1024) throw new Error("Workflow draft exceeds 1 MiB");
      const input = { workflowText, workflowDir: request.workflowDir };
      const { checked, validation } = inspectWorkflow(
        input,
        request.run ? { taskSourceConsumed: true } : undefined,
      );
      const transitions: BrowserDraft["transitions"] = Object.create(null);
      const compiled = checked.compiled;
      if (compiled) {
        for (const step of compiled.steps.values()) {
          const declared = new Set(step.outcomes);
          transitions[step.id] =
            step.kind === "end"
              ? []
              : [...step.outcomes, ...SYSTEM_OUTCOMES].map((outcome) =>
                  resolveOutcome(compiled, step.id, outcome, declared),
                );
        }
      }
      return {
        ...input,
        document: checked.document ?? null,
        valid: validation.valid,
        diagnostics: validation.diagnostics,
        projectRoot: checked.compiled?.projectRoot ?? null,
        transitions,
        systemOutcomes: SYSTEM_OUTCOMES,
      } satisfies BrowserDraft;
    }
    if (request.op === "session") return this.management.handle({ op: "ping" });
    if (request.op === "logout") throw new Error("logout is handled by browser transport");
    if (request.op === "runs") return this.management.handle(request);
    if (
      request.op === "status" ||
      request.op === "reports" ||
      request.op === "events" ||
      request.op === "start" ||
      request.op === "pause" ||
      request.op === "stop" ||
      request.op === "resume"
    )
      return this.management.handle(request);
    if (request.op === "workflows") {
      return this.management.store.listRevisions().map((revision) => {
        const parsed = parseWorkflowText(revision.definitionYaml);
        return {
          revisionId: revision.revisionId,
          name: parsed.document?.name ?? "Invalid saved definition",
          sourceDir: revision.sourceDir,
          sha256: revision.definitionSha256,
        };
      });
    }
    const input = this.source(request.source);
    const parsed = parseWorkflowText(input.workflowText);
    if (!parsed.document) throw new WorkflowInvalidError(parsed.diagnostics);
    if (request.op === "load") {
      const checked = checkWorkflowText(input.workflowText, { workflowDir: input.workflowDir });
      if (!checked.compiled) throw new WorkflowInvalidError(checked.diagnostics);
      return {
        name: parsed.document.name,
        workflowDir: input.workflowDir,
        workflowText: input.workflowText,
        projectRoot: checked.compiled.projectRoot,
        instructions: parsed.document.project.instructions ?? [],
        taskPath: parsed.document.tasks?.source.path ?? null,
        diagnostics: checked.diagnostics,
      };
    }
    if (request.op === "save" || request.op === "create") {
      const validation = validateWorkflow(input);
      if (!validation.valid) throw new WorkflowInvalidError(validation.diagnostics);
    }
    // Do not serialize untouched sources: keep exact revision identity where possible.
    const document = parseDocument(input.workflowText, { schema: "core" });
    const root = checkWorkflowText(input.workflowText, { workflowDir: input.workflowDir }).compiled
      ?.projectRoot;
    let changed = false;
    if (root !== request.projectRoot) {
      document.setIn(["project", "root"], request.projectRoot);
      changed = true;
    }
    if (
      JSON.stringify(parsed.document.project.instructions ?? []) !==
      JSON.stringify(request.instructions)
    ) {
      document.setIn(["project", "instructions"], request.instructions);
      changed = true;
    }
    if ((parsed.document.tasks?.source.path ?? null) !== request.taskPath) {
      if (request.taskPath === null) document.deleteIn(["tasks"]);
      else
        document.setIn(["tasks"], {
          source: { kind: "markdown_checklist", path: request.taskPath },
        });
      changed = true;
    }
    const configured = {
      workflowText: changed ? document.toString() : input.workflowText,
      workflowDir: input.workflowDir,
    };
    if (request.op === "save") return this.management.handle({ op: "import", ...configured });
    return this.management.handle({
      op: request.op,
      ...configured,
      includeCompleted: request.includeCompleted,
    });
  }
}
