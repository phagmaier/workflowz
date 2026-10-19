/**
 * Turns a dispatched attempt into something a process can run: interpolated argv, prompt, and
 * environment, plus absolute paths. Any failure here is a pre-execution error. The runner settles
 * it as `system.internal_error` (or `system.resume_unavailable` for missing sessions) and never
 * starts a process, so a broken placeholder cannot run half a command.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AgentAdapter, AgentInput } from "../adapters/agent-adapter.js";
import type { CommandSpec } from "../adapters/command-executor.js";
import type { SystemOutcome } from "../contracts/identifiers.js";
import { type InterpolationValues, interpolate } from "../engine/interpolate.js";
import type { CompiledStep, CompiledWorkflow } from "../engine/model.js";
import type { TaskRow } from "../store/run-store.js";

export class PreparationError extends Error {
  constructor(
    message: string,
    readonly code: SystemOutcome = "system.internal_error",
  ) {
    super(message);
    this.name = "PreparationError";
  }
}

export type PreparedAttempt =
  | { readonly kind: "command"; readonly spec: CommandSpec }
  | { readonly kind: "agent"; readonly adapter: AgentAdapter; readonly input: AgentInput };

export interface PrepareContext {
  readonly workflow: CompiledWorkflow;
  readonly runId: string;
  readonly step: CompiledStep;
  readonly attemptId: string;
  readonly task: TaskRow | undefined;
  readonly logDir: string;
  readonly adapters: ReadonlyMap<string, AgentAdapter>;
  readonly commandStdout: (stepId: string) => string | undefined;
}

export function prepareAttempt(context: PrepareContext): PreparedAttempt {
  try {
    return prepare(context);
  } catch (error) {
    if (error instanceof PreparationError) {
      throw error;
    }
    throw new PreparationError(error instanceof Error ? error.message : String(error));
  }
}

function prepare(context: PrepareContext): PreparedAttempt {
  const { workflow, step } = context;
  const values: InterpolationValues = {
    task: context.task
      ? { id: context.task.taskId, text: context.task.title, index: context.task.sourceOrder + 1 }
      : undefined,
    projectRoot: workflow.projectRoot,
    runId: context.runId,
    runCwd: workflow.projectRoot,
    commandStdout: context.commandStdout,
    report: () => undefined,
  };
  const workingDirectory = (raw: string | undefined): string =>
    path.resolve(workflow.projectRoot, interpolate(raw ?? ".", values));
  const logPath = path.join(context.logDir, `${context.attemptId}.log`);

  const spec = step.spec;
  if (spec.kind === "command") {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(spec.env ?? {})) {
      env[name] = interpolate(value, values);
    }
    return {
      kind: "command",
      spec: {
        argv: spec.argv.map((arg) => interpolate(arg, values)),
        cwd: workingDirectory(spec.cwd),
        env,
        timeoutMs: spec.timeout_seconds === undefined ? undefined : spec.timeout_seconds * 1000,
        logPath,
      },
    };
  }

  if (spec.kind === "agent") {
    if (spec.session === "resume") {
      throw new PreparationError(
        `step '${step.id}' requires a persisted session, but session resume is not available`,
        "system.resume_unavailable",
      );
    }
    const adapter = context.adapters.get(spec.harness);
    if (!adapter) {
      throw new PreparationError(`no adapter is registered for harness '${spec.harness}'`);
    }
    const prompt =
      spec.prompt !== undefined
        ? interpolate(spec.prompt, values)
        : interpolate(
            readFileSync(
              path.resolve(workflow.projectRoot, interpolate(spec.prompt_file ?? "", values)),
              "utf8",
            ),
            values,
          );
    return {
      kind: "agent",
      adapter,
      input: {
        attemptId: context.attemptId,
        cwd: workingDirectory(spec.cwd),
        prompt,
        instructionFiles: (spec.instructions ?? []).map((file) =>
          path.resolve(workflow.projectRoot, interpolate(file, values)),
        ),
        allowedOutcomes: step.outcomes,
        timeoutMs: spec.timeout_seconds === undefined ? undefined : spec.timeout_seconds * 1000,
        logPath,
      },
    };
  }

  throw new PreparationError(`step '${step.id}' of kind ${spec.kind} does not run a process`);
}
