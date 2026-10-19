/** Pure, bounded run-local specialization and cursor compatibility checks. */

import { scanPlaceholders } from "../contracts/interpolation.js";
import type { TaskOverrides } from "../contracts/run-configuration.js";
import type { WorkflowDocument, WorkflowStep } from "../contracts/workflow-schema.js";
import type { CompiledWorkflow } from "./model.js";

export class RunConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunConfigurationError";
  }
}

/** Only existing executable steps can be specialized. The normal compiler validates the result. */
export function specializeTask(
  document: WorkflowDocument,
  overrides: TaskOverrides,
): WorkflowDocument {
  const steps: Record<string, WorkflowStep> = { ...document.steps };
  for (const [id, override] of Object.entries(overrides.steps)) {
    const step = Object.hasOwn(steps, id) ? steps[id] : undefined;
    if (!step || (step.kind !== "agent" && step.kind !== "command")) {
      throw new RunConfigurationError(
        `task override '${id}' must name an existing agent or command step`,
      );
    }
    if (step.kind !== "agent" && (override.model !== undefined || override.prompt !== undefined)) {
      throw new RunConfigurationError(`model/prompt overrides require an agent step ('${id}')`);
    }
    if (
      override.skip &&
      !(step.kind === "agent" ? step.outcomes : ["complete", "failed"]).includes(
        override.skip.outcome,
      )
    ) {
      throw new RunConfigurationError(
        `skip outcome '${override.skip.outcome}' is not declared by '${id}'`,
      );
    }
    const on = { ...step.on, ...override.on };
    if (step.kind === "agent") {
      const { prompt_file, ...rest } = step;
      steps[id] = {
        ...rest,
        ...(override.prompt === undefined && prompt_file !== undefined ? { prompt_file } : {}),
        ...(override.prompt === undefined ? {} : { prompt: override.prompt }),
        ...(override.model === undefined ? {} : { model: override.model }),
        on,
      };
    } else {
      steps[id] = { ...step, on };
    }
  }
  return { ...document, steps };
}

/** A changed/missing cursor needs an explicit choice; task-control preconditions always apply. */
export function revisionCursor(
  previous: CompiledWorkflow,
  revised: CompiledWorkflow,
  cursor: string,
  activeTaskId: string | null,
  explicit?: string,
): string {
  const selected = explicit ?? cursor;
  const step = revised.steps.get(selected);
  if (!step) {
    throw new RunConfigurationError(
      `revision has no cursor step '${selected}'; choose an explicit valid cursorStepId`,
    );
  }
  if (explicit === undefined && previous.steps.get(cursor)?.kind !== step.kind) {
    throw new RunConfigurationError(
      `revision changes cursor '${cursor}' kind; choose an explicit valid cursorStepId`,
    );
  }
  if (
    (step.kind === "task.next" && activeTaskId !== null) ||
    (step.kind === "task.complete" && activeTaskId === null)
  ) {
    throw new RunConfigurationError(
      `cursor '${selected}' (${step.kind}) is incompatible with the active task; choose an explicit valid cursorStepId`,
    );
  }
  const spec = step.spec;
  const templates =
    spec.kind === "agent"
      ? [spec.prompt, spec.prompt_file, spec.cwd, ...(spec.instructions ?? [])]
      : spec.kind === "command"
        ? [...spec.argv, spec.cwd, ...Object.values(spec.env ?? {})]
        : [];
  if (
    activeTaskId === null &&
    templates.some(
      (value) =>
        value !== undefined &&
        scanPlaceholders(value).some((placeholder) => placeholder.ref?.kind === "task"),
    )
  ) {
    throw new RunConfigurationError(
      `cursor '${selected}' requires an active task; choose an explicit valid cursorStepId`,
    );
  }
  return selected;
}
