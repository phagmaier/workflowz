/** Browser edits are drafts only; validation, immutable writes and execution stay in management. */
import { parseDocument, stringify } from "yaml";
import type { BrowserRequest, BrowserSource } from "../contracts/browser.js";
import type { Diagnostic } from "../contracts/diagnostics.js";
import { SYSTEM_OUTCOMES } from "../contracts/identifiers.js";
import { parseWorkflowText } from "../contracts/parse-workflow.js";
import type { WorkflowDocument } from "../contracts/workflow-schema.js";
import { checkWorkflowText } from "../engine/check.js";
import type { ResolvedTransition } from "../engine/model.js";
import { resolveOutcome } from "../engine/routing.js";
import { WorkflowInvalidError } from "../engine/run-coordinator.js";
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
export class BrowserService {
  constructor(private readonly management: ManagementService) {}

  private source(source: BrowserSource) {
    if ("revisionId" in source) {
      const revision = this.management.store.getRevision(source.revisionId);
      return { workflowText: revision.definitionYaml, workflowDir: revision.sourceDir };
    }
    return source;
  }

  async handle(request: BrowserRequest): Promise<unknown> {
    if (request.op === "draft") {
      const workflowText =
        request.model === undefined ? request.workflowText : stringify(request.model);
      if (workflowText.length > 1024 * 1024) throw new Error("Workflow draft exceeds 1 MiB");
      const input = { workflowText, workflowDir: request.workflowDir };
      const { checked, validation } = inspectWorkflow(input);
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
