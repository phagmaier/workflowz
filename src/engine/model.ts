/**
 * Compiled workflow model: the deterministic transition table the runner consumes.
 *
 * A `CompiledWorkflow` is immutable and pure data. It has no handles to files, processes, or
 * databases, so the same revision always routes the same way (spec §1.1 principle 4).
 */
import type { Diagnostic } from "../contracts/diagnostics.js";
import type { PolicyDeclaration, StepKind, WorkflowStep } from "../contracts/workflow-schema.js";

/** What the runner does next. Exactly one per transition (spec §3.3). */
export type Action =
  | { readonly kind: "goto"; readonly target: string }
  | { readonly kind: "pause" }
  | { readonly kind: "retry"; readonly maxAttempts: number; readonly backoffSeconds: number };

/** Where a resolved transition came from, for display and audit. */
export type RuleSource =
  | { readonly level: "step" }
  | { readonly level: "step_id_policy"; readonly policyIndex: number }
  | { readonly level: "tag_policy"; readonly policyIndex: number }
  | { readonly level: "all_policy"; readonly policyIndex: number }
  | { readonly level: "defaults" }
  | { readonly level: "built_in_pause" };

export interface ResolvedTransition {
  readonly outcome: string;
  readonly action: Action;
  readonly source: RuleSource;
  /** True when a `system.*` outcome had no exact rule and used the `system.error` catch-all. */
  readonly viaSystemError: boolean;
}

export interface CompiledStep {
  readonly id: string;
  readonly kind: StepKind;
  readonly tags: readonly string[];
  /** Normal outcomes this step may finish with. Never includes `system.*` names. */
  readonly outcomes: readonly string[];
  /** The step's own transitions, typed. Policies and defaults are consulted when this lacks a key. */
  readonly on: Readonly<Record<string, Action>>;
  readonly spec: WorkflowStep;
}

export interface CompiledPolicy {
  readonly index: number;
  readonly match: PolicyDeclaration["match"];
  readonly on: Readonly<Record<string, Action>>;
}

/** The rule inputs that routing reads. Kept separate so the compiler can use it before the
 * transition table exists. */
export interface RuleSet {
  readonly steps: ReadonlyMap<string, CompiledStep>;
  readonly policies: readonly CompiledPolicy[];
  readonly defaults: Readonly<Record<string, Action>>;
}

export interface CompiledWorkflow extends RuleSet {
  readonly name: string;
  readonly start: string;
  /** Absolute project root, resolved against the workflow file's directory. */
  readonly projectRoot: string;
  /** Absolute instruction file paths, in declared order. */
  readonly instructions: readonly string[];
  /** Absolute path of the Markdown checklist, when the workflow imports tasks. */
  readonly tasksSourcePath?: string | undefined;
  readonly limits: {
    readonly maxWallTimeSeconds?: number | undefined;
    readonly maxStepExecutions?: number | undefined;
    readonly agentIdleTimeoutSeconds?: number | undefined;
  };
  readonly reportCorrectionAttempts: 0 | 1;
  /** Fully resolved transitions for every normal outcome of every step. */
  readonly transitions: ReadonlyMap<string, ReadonlyMap<string, ResolvedTransition>>;
  /** Warnings from a successful compile. Errors never reach a compiled workflow. */
  readonly warnings: readonly Diagnostic[];
}
