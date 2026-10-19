/**
 * Typed schema for YAML workflow v1 (spec §3). This layer checks shape only: field types, closed
 * key sets, and per-kind fields. Semantic rules (outcome completeness, references, policy
 * conflicts, templates) live in `src/engine/compile.ts`, so they can be tested without YAML.
 *
 * Every object is `strict`: unknown keys are errors, never silently ignored (spec §3.1).
 */
import { z } from "zod";
import { IDENTIFIER_PATTERN, isReservedName } from "./identifiers.js";

export const STEP_KINDS = ["agent", "command", "task.next", "task.complete", "end"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

/** Custom issues carry the diagnostic code they should surface as in `params.diagnosticCode`. */
function coded(diagnosticCode: string, message: string) {
  return { message, params: { diagnosticCode } };
}

const identifier = z.string().regex(IDENTIFIER_PATTERN, {
  error: "must be 1-64 characters: a lowercase letter, then lowercase letters, digits or '_'",
});

const nonEmptyString = z.string().min(1, { error: "must not be empty" });

const positiveInteger = z.number().int().positive();

/** Outcome names are identifiers, but the `system.` namespace gets its own, clearer error. */
const outcomeName = z.string().superRefine((value, ctx) => {
  if (isReservedName(value)) {
    ctx.addIssue({
      code: "custom",
      ...coded(
        "reserved_outcome",
        `'${value}' is reserved for engine outcomes and cannot be declared by a step`,
      ),
    });
    return;
  }
  if (!IDENTIFIER_PATTERN.test(value)) {
    ctx.addIssue({
      code: "custom",
      ...coded(
        "invalid_outcome",
        `outcome '${value}' must be 1-64 characters: a lowercase letter, then lowercase letters, digits or '_'`,
      ),
    });
  }
});

const retryPolicy = z.strictObject({
  max_attempts: z
    .number()
    .int()
    .min(2, { error: "must be at least 2 (a retry needs at least one extra attempt)" })
    .max(100, { error: "must be at most 100" }),
  backoff_seconds: z.number().int().min(0).max(86_400).default(0),
});

/** Exactly one action per transition (spec §3.3). */
export const transitionAction = z.union(
  [
    z.strictObject({ goto: identifier }),
    z.strictObject({ pause: z.literal(true) }),
    z.strictObject({ retry: retryPolicy }),
  ],
  {
    error:
      "must have exactly one action: {goto: <step_id>}, {pause: true}, or {retry: {max_attempts: N}}",
  },
);

/** Keys are outcome names or `system.*` codes; the compiler checks which is which. */
export const transitionMap = z.record(z.string(), transitionAction);

const contextSpec = z.strictObject({
  include_reports: z.array(identifier).optional(),
});

const agentStep = z
  .strictObject({
    kind: z.literal("agent"),
    harness: nonEmptyString,
    model: nonEmptyString.optional(),
    reasoning_effort: nonEmptyString.optional(),
    session: z.enum(["fresh", "resume"], {
      error: "must be 'fresh' or 'resume'",
    }),
    prompt: nonEmptyString.optional(),
    prompt_file: nonEmptyString.optional(),
    instructions: z.array(nonEmptyString).optional(),
    cwd: nonEmptyString.optional(),
    outcomes: z.array(outcomeName).min(1, { error: "must declare at least one outcome" }),
    on: transitionMap.optional(),
    tags: z.array(identifier).optional(),
    timeout_seconds: positiveInteger.optional(),
    context: contextSpec.optional(),
  })
  .superRefine((step, ctx) => {
    const hasPrompt = step.prompt !== undefined;
    const hasPromptFile = step.prompt_file !== undefined;
    if (hasPrompt === hasPromptFile) {
      ctx.addIssue({
        code: "custom",
        ...coded(
          "invalid_field",
          hasPrompt
            ? "set either 'prompt' or 'prompt_file', not both"
            : "one of 'prompt' or 'prompt_file' is required",
        ),
        path: [],
      });
    }
    const unique = new Set(step.outcomes);
    if (unique.size !== step.outcomes.length) {
      ctx.addIssue({
        code: "custom",
        ...coded("invalid_field", "outcomes must be unique"),
        path: ["outcomes"],
      });
    }
  });

const commandStep = z.strictObject({
  kind: z.literal("command"),
  argv: z
    .array(z.string())
    .min(1, { error: "must contain at least the executable" })
    .refine((argv) => argv.length === 0 || (argv[0] ?? "").length > 0, {
      error: "executable (argv[0]) must not be empty",
    }),
  cwd: nonEmptyString.optional(),
  env: z
    .record(
      z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, { error: "must be a valid variable name" }),
      z.string(),
    )
    .optional(),
  timeout_seconds: positiveInteger.optional(),
  on: transitionMap.optional(),
  tags: z.array(identifier).optional(),
});

const taskNextStep = z.strictObject({
  kind: z.literal("task.next"),
  on: transitionMap.optional(),
  tags: z.array(identifier).optional(),
});

const taskCompleteStep = z.strictObject({
  kind: z.literal("task.complete"),
  on: transitionMap.optional(),
  tags: z.array(identifier).optional(),
});

const endStep = z.strictObject({
  kind: z.literal("end"),
  label: nonEmptyString.optional(),
});

export const STEP_SCHEMAS = {
  agent: agentStep,
  command: commandStep,
  "task.next": taskNextStep,
  "task.complete": taskCompleteStep,
  end: endStep,
} as const;

export type AgentStep = z.infer<typeof agentStep>;
export type CommandStep = z.infer<typeof commandStep>;
export type TaskNextStep = z.infer<typeof taskNextStep>;
export type TaskCompleteStep = z.infer<typeof taskCompleteStep>;
export type EndStep = z.infer<typeof endStep>;
export type WorkflowStep = AgentStep | CommandStep | TaskNextStep | TaskCompleteStep | EndStep;

export const policySchema = z.strictObject({
  match: z.union(
    [
      z.strictObject({ tags: z.array(identifier).min(1) }),
      z.strictObject({ step_ids: z.array(identifier).min(1) }),
      z.strictObject({ all: z.literal(true) }),
    ],
    {
      error: "must be exactly one of {tags: [...]}, {step_ids: [...]}, or {all: true}",
    },
  ),
  on: transitionMap.refine((map) => Object.keys(map).length > 0, {
    error: "must map at least one outcome",
  }),
});

export type PolicyDeclaration = z.infer<typeof policySchema>;

/** Top-level keys except `steps`, which is validated one step at a time for precise errors. */
export const workflowHeaderSchema = z.strictObject({
  version: z.literal(1, { error: "unsupported workflow version; this build accepts version 1" }),
  name: nonEmptyString,
  project: z.strictObject({
    root: nonEmptyString,
    instructions: z.array(nonEmptyString).optional(),
  }),
  tasks: z
    .strictObject({
      source: z.strictObject({
        kind: z.literal("markdown_checklist", { error: "must be 'markdown_checklist'" }),
        path: nonEmptyString,
      }),
    })
    .optional(),
  start: identifier,
  limits: z
    .strictObject({
      max_wall_time_seconds: positiveInteger.optional(),
      max_step_executions: positiveInteger.optional(),
      agent_idle_timeout_seconds: positiveInteger.optional(),
    })
    .optional(),
  defaults: z
    .strictObject({
      report_correction_attempts: z
        .union([z.literal(0), z.literal(1)], { error: "must be 0 or 1" })
        .optional(),
      on: transitionMap.optional(),
    })
    .optional(),
  policies: z.array(policySchema).optional(),
  steps: z.record(z.string(), z.unknown()),
});

export type WorkflowHeader = z.infer<typeof workflowHeaderSchema>;

/** A workflow document after shape validation. Semantic checks have not run yet. */
export type WorkflowDocument = Omit<WorkflowHeader, "steps"> & {
  readonly steps: Readonly<Record<string, WorkflowStep>>;
};
