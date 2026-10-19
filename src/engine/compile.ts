/**
 * Semantic validation and compilation of a parsed workflow document into a `CompiledWorkflow`.
 *
 * Every rule here is a check the spec requires before a run may start (spec §2.2, §3.3, arch §3):
 * declared outcomes, complete transitions, unambiguous policies, resolvable references, fixed
 * placeholders, harness capabilities. Warnings (unreachable steps, unbounded loops) never block a
 * compile. The compiler is pure: it reads no files and spawns no processes.
 */
import path from "node:path";
import { BUILT_IN_HARNESSES, type HarnessRegistry } from "../adapters/harness-registry.js";
import type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticPath,
  SourceLocation,
} from "../contracts/diagnostics.js";
import { errorDiagnostic, warningDiagnostic } from "../contracts/diagnostics.js";
import {
  isIdentifier,
  isReservedName,
  isSystemOutcome,
  SYSTEM_OUTCOMES,
} from "../contracts/identifiers.js";
import { scanPlaceholders } from "../contracts/interpolation.js";
import type { WorkflowDocument, WorkflowStep } from "../contracts/workflow-schema.js";
import { nodesOnCycles, reachableFrom } from "./graph.js";
import type {
  Action,
  CompiledPolicy,
  CompiledStep,
  CompiledWorkflow,
  ResolvedTransition,
  RuleSet,
} from "./model.js";
import {
  lookupExactRule,
  type PolicyLevel,
  policyCovers,
  policyLevel,
  resolveOutcome,
} from "./routing.js";

export interface CompileOptions {
  /** Directory of the workflow file. Relative `project.root` and task paths resolve against it. */
  readonly workflowDir: string;
  /** Known harnesses. Defaults to the built-in registry. */
  readonly harnesses?: HarnessRegistry;
  /** Attaches source locations to diagnostics when the source text is known. */
  readonly locate?: (path: DiagnosticPath) => SourceLocation | undefined;
}

export interface CompileOutcome {
  readonly compiled?: CompiledWorkflow;
  readonly diagnostics: readonly Diagnostic[];
}

const PLAIN_CONTEXT = { templated: false } as const;
const TEMPLATED_CONTEXT = { templated: true } as const;

/** Outcomes the engine assigns to each step kind. Agent outcomes are declared by the user. */
const TASK_NEXT_OUTCOMES = ["task_ready", "exhausted"] as const;
const COMMAND_OUTCOMES = ["complete", "failed"] as const;

export function compileWorkflow(
  document: WorkflowDocument,
  options: CompileOptions,
): CompileOutcome {
  return new Compilation(document, options).run();
}

class Compilation {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly harnesses: HarnessRegistry;
  private readonly seenMessages = new Set<string>();

  constructor(
    private readonly doc: WorkflowDocument,
    private readonly options: CompileOptions,
  ) {
    this.harnesses = options.harnesses ?? BUILT_IN_HARNESSES;
  }

  run(): CompileOutcome {
    const stepIds = new Set(Object.keys(this.doc.steps));
    this.checkHeader();

    if (!stepIds.has(this.doc.start)) {
      this.error("unknown_step", `start step '${this.doc.start}' is not declared under steps`, [
        "start",
      ]);
    }

    const steps = this.buildSteps();
    const policies = this.buildPolicies();
    const defaults = convertOn(this.doc.defaults?.on ?? {});
    const rules: RuleSet = { steps, policies, defaults };

    for (const [id, spec] of Object.entries(this.doc.steps)) {
      this.checkStep(id, spec, stepIds);
    }
    this.checkPolicies(policies, steps, stepIds);
    this.checkDefaults(defaults, steps);

    const transitions = this.buildTransitions(rules, steps);
    this.checkConflicts(rules, steps);
    this.checkGraph(rules, steps, stepIds);

    if (this.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return { diagnostics: this.diagnostics };
    }

    const projectRoot = path.resolve(this.options.workflowDir, this.doc.project.root);
    const compiled: CompiledWorkflow = {
      name: this.doc.name,
      start: this.doc.start,
      projectRoot,
      instructions: (this.doc.project.instructions ?? []).map((file) =>
        path.resolve(projectRoot, file),
      ),
      tasksSourcePath: this.doc.tasks
        ? path.resolve(projectRoot, this.doc.tasks.source.path)
        : undefined,
      limits: {
        maxWallTimeSeconds: this.doc.limits?.max_wall_time_seconds,
        maxStepExecutions: this.doc.limits?.max_step_executions,
        agentIdleTimeoutSeconds: this.doc.limits?.agent_idle_timeout_seconds,
      },
      reportCorrectionAttempts: this.doc.defaults?.report_correction_attempts ?? 1,
      steps,
      policies,
      defaults,
      transitions,
      warnings: this.diagnostics,
    };
    return { compiled, diagnostics: this.diagnostics };
  }

  private checkHeader(): void {
    const plainFields: [DiagnosticPath, string | undefined][] = [
      [["name"], this.doc.name],
      [["project", "root"], this.doc.project.root],
      ...(this.doc.tasks
        ? [[["tasks", "source", "path"], this.doc.tasks.source.path] as [DiagnosticPath, string]]
        : []),
    ];
    for (const [fieldPath, value] of plainFields) {
      if (value !== undefined) {
        this.checkTemplate(value, fieldPath, PLAIN_CONTEXT);
      }
    }
    (this.doc.project.instructions ?? []).forEach((file, index) => {
      this.checkTemplate(file, ["project", "instructions", index], PLAIN_CONTEXT);
    });
  }

  /** Builds the typed steps first, so later checks can read kinds, tags, and outcomes. */
  private buildSteps(): Map<string, CompiledStep> {
    const steps = new Map<string, CompiledStep>();
    for (const [id, spec] of Object.entries(this.doc.steps)) {
      const on = spec.kind === "end" ? {} : (spec.on ?? {});
      steps.set(id, {
        id,
        kind: spec.kind,
        tags: spec.kind === "end" ? [] : (spec.tags ?? []),
        outcomes: [...outcomesOf(spec)],
        on: convertOn(on),
        spec,
      });
    }
    return steps;
  }

  private buildPolicies(): CompiledPolicy[] {
    return (this.doc.policies ?? []).map((policy, index) => ({
      index,
      match: policy.match,
      on: convertOn(policy.on),
    }));
  }

  private checkStep(id: string, spec: WorkflowStep, stepIds: ReadonlySet<string>): void {
    const base: DiagnosticPath = ["steps", id];
    const declared = outcomesOf(spec);

    if (spec.kind !== "end") {
      this.checkTransitionMap(id, spec.on ?? {}, declared, spec.kind, stepIds);
    }
    if (spec.kind === "task.next" || spec.kind === "task.complete") {
      if (!this.doc.tasks) {
        this.error("tasks_required", `${spec.kind} needs a task source; declare tasks.source`, [
          ...base,
          "kind",
        ]);
      }
    }
    if (spec.kind === "agent") {
      this.checkAgent(id, spec, stepIds);
    }
    if (spec.kind === "command") {
      this.checkCommand(id, spec);
    }
    if (spec.kind === "end") {
      this.checkTemplate(spec.label ?? "", [...base, "label"], PLAIN_CONTEXT);
    }
  }

  private checkAgent(
    id: string,
    spec: Extract<WorkflowStep, { kind: "agent" }>,
    stepIds: ReadonlySet<string>,
  ): void {
    const base: DiagnosticPath = ["steps", id];
    const descriptor = this.harnesses.get(spec.harness);
    if (!descriptor) {
      this.error(
        "unknown_harness",
        `unknown harness '${spec.harness}'; registered harnesses are ${[...this.harnesses.keys()].join(", ")}`,
        [...base, "harness"],
      );
    } else {
      if (spec.session === "resume" && !descriptor.capabilities.supportsResume) {
        this.error(
          "unsupported_capability",
          `harness '${spec.harness}' does not support session resume, so 'session: resume' cannot be used`,
          [...base, "session"],
        );
      }
      if (spec.model !== undefined && !descriptor.capabilities.supportsModelSelection) {
        this.error(
          "unsupported_capability",
          `harness '${spec.harness}' does not support model selection`,
          [...base, "model"],
        );
      }
      if (spec.reasoning_effort !== undefined && !descriptor.capabilities.supportsReasoningEffort) {
        this.error(
          "unsupported_capability",
          `harness '${spec.harness}' does not support reasoning effort selection`,
          [...base, "reasoning_effort"],
        );
      }
    }
    this.checkTemplate(spec.harness, [...base, "harness"], PLAIN_CONTEXT);
    if (spec.model !== undefined) {
      this.checkTemplate(spec.model, [...base, "model"], PLAIN_CONTEXT);
    }
    if (spec.reasoning_effort !== undefined) {
      this.checkTemplate(spec.reasoning_effort, [...base, "reasoning_effort"], PLAIN_CONTEXT);
    }
    if (spec.prompt !== undefined) {
      this.checkTemplate(spec.prompt, [...base, "prompt"], TEMPLATED_CONTEXT);
    }
    if (spec.prompt_file !== undefined) {
      this.checkTemplate(spec.prompt_file, [...base, "prompt_file"], TEMPLATED_CONTEXT);
    }
    if (spec.cwd !== undefined) {
      this.checkTemplate(spec.cwd, [...base, "cwd"], TEMPLATED_CONTEXT);
    }
    (spec.instructions ?? []).forEach((file, index) => {
      this.checkTemplate(file, [...base, "instructions", index], TEMPLATED_CONTEXT);
    });

    (spec.context?.include_reports ?? []).forEach((reportStep, index) => {
      const reportPath = [...base, "context", "include_reports", index];
      if (!stepIds.has(reportStep)) {
        this.error(
          "unknown_step",
          `include_reports refers to unknown step '${reportStep}'`,
          reportPath,
        );
      } else if (this.doc.steps[reportStep]?.kind !== "agent") {
        this.error(
          "invalid_field",
          `include_reports can only name agent steps; '${reportStep}' is not one`,
          reportPath,
        );
      }
    });
  }

  private checkCommand(id: string, spec: Extract<WorkflowStep, { kind: "command" }>): void {
    const base: DiagnosticPath = ["steps", id];
    spec.argv.forEach((arg, index) => {
      this.checkTemplate(arg, [...base, "argv", index], TEMPLATED_CONTEXT);
    });
    if (spec.cwd !== undefined) {
      this.checkTemplate(spec.cwd, [...base, "cwd"], TEMPLATED_CONTEXT);
    }
    for (const [name, value] of Object.entries(spec.env ?? {})) {
      this.checkTemplate(value, [...base, "env", name], TEMPLATED_CONTEXT);
    }
  }

  /** Every key must be a declared outcome of the step, or a known `system.*` outcome. */
  private checkTransitionMap(
    id: string,
    on: Readonly<Record<string, unknown>>,
    declared: readonly string[],
    kind: string,
    stepIds: ReadonlySet<string>,
  ): void {
    for (const key of Object.keys(on)) {
      const keyPath: DiagnosticPath = ["steps", id, "on", key];
      if (isSystemOutcome(key)) {
        // known engine outcome; nothing else to check for the key itself
      } else if (isReservedName(key)) {
        this.error("unknown_transition_key", `'${key}' is not a known engine outcome`, keyPath);
      } else if (!declared.includes(key)) {
        this.error(
          "undeclared_outcome",
          `'${key}' is not an outcome of this ${kind} step; it declares ${declared.length > 0 ? declared.join(", ") : "no outcomes"}`,
          keyPath,
        );
      }
      this.checkGoto(on[key], keyPath, stepIds);
    }
  }

  private checkPolicies(
    policies: readonly CompiledPolicy[],
    steps: ReadonlyMap<string, CompiledStep>,
    stepIds: ReadonlySet<string>,
  ): void {
    for (const policy of policies) {
      const base: DiagnosticPath = ["policies", policy.index];
      const match = policy.match;
      if ("step_ids" in match) {
        match.step_ids.forEach((stepId, index) => {
          if (!stepIds.has(stepId)) {
            this.error("unknown_step", `policy targets unknown step '${stepId}'`, [
              ...base,
              "match",
              "step_ids",
              index,
            ]);
          }
        });
      }
      const covered = [...steps.values()].filter((step) => policyCovers(policy, step));
      if ("tags" in match && covered.length === 0) {
        this.warn(
          "policy_matches_no_steps",
          `policy tags ${match.tags.join(", ")} do not match any step`,
          [...base, "match"],
        );
      }
      for (const key of Object.keys(policy.on)) {
        const keyPath: DiagnosticPath = [...base, "on", key];
        this.checkPolicyKey(key, covered, keyPath, "this policy's steps");
        this.checkGoto(this.doc.policies?.[policy.index]?.on[key], keyPath, stepIds);
      }
    }
  }

  private checkDefaults(
    defaults: Readonly<Record<string, Action>>,
    steps: ReadonlyMap<string, CompiledStep>,
  ): void {
    const everyStep = [...steps.values()];
    for (const key of Object.keys(defaults)) {
      const keyPath: DiagnosticPath = ["defaults", "on", key];
      this.checkPolicyKey(key, everyStep, keyPath, "any step");
      this.checkGoto(this.doc.defaults?.on?.[key], keyPath, new Set(steps.keys()));
    }
  }

  /** A policy or default key must be a `system.*` outcome or an outcome some covered step declares. */
  private checkPolicyKey(
    key: string,
    covered: readonly CompiledStep[],
    keyPath: DiagnosticPath,
    scope: string,
  ): void {
    if (isSystemOutcome(key)) {
      return;
    }
    if (isReservedName(key)) {
      this.error("unknown_transition_key", `'${key}' is not a known engine outcome`, keyPath);
      return;
    }
    if (!isIdentifier(key)) {
      this.error("invalid_outcome", `outcome '${key}' is not a valid outcome name`, keyPath);
      return;
    }
    if (covered.length > 0 && !covered.some((step) => step.outcomes.includes(key))) {
      this.error(
        "unknown_outcome_in_policy",
        `outcome '${key}' is not declared by ${scope}`,
        keyPath,
      );
    }
  }

  private checkGoto(action: unknown, keyPath: DiagnosticPath, stepIds: ReadonlySet<string>): void {
    if (
      typeof action === "object" &&
      action !== null &&
      "goto" in action &&
      typeof action.goto === "string"
    ) {
      if (!stepIds.has(action.goto)) {
        this.error("unknown_step", `goto target '${action.goto}' is not a declared step`, keyPath);
      }
    }
  }

  /**
   * Every normal outcome a step can produce must resolve to an exact rule (spec §3.3). Returns the
   * table of those resolutions. A step without one is an incomplete transition, not an automatic pause.
   */
  private buildTransitions(
    rules: RuleSet,
    steps: ReadonlyMap<string, CompiledStep>,
  ): Map<string, Map<string, ResolvedTransition>> {
    const table = new Map<string, Map<string, ResolvedTransition>>();
    for (const step of steps.values()) {
      const row = new Map<string, ResolvedTransition>();
      for (const outcome of step.outcomes) {
        const rule = lookupExactRule(rules, step.id, outcome);
        if (rule) {
          row.set(outcome, rule);
        } else {
          this.error(
            "incomplete_transition",
            `outcome '${outcome}' has no transition; add steps.${step.id}.on.${outcome}, a matching policy, or defaults.on.${outcome}`,
            ["steps", step.id, "on"],
          );
        }
      }
      table.set(step.id, row);
    }
    return table;
  }

  /**
   * Two policies at the same precedence level that cover the same step and outcome must agree.
   * The check runs for every declared outcome and every `system.*` key a policy mentions, and it
   * skips pairs that the step's own `on` already resolves.
   */
  private checkConflicts(rules: RuleSet, steps: ReadonlyMap<string, CompiledStep>): void {
    const systemKeys = new Set<string>();
    for (const policy of rules.policies) {
      for (const key of Object.keys(policy.on)) {
        if (isSystemOutcome(key)) {
          systemKeys.add(key);
        }
      }
    }
    const levels: PolicyLevel[] = ["step_id", "tag", "all"];
    for (const step of steps.values()) {
      const candidates = new Set([...step.outcomes, ...systemKeys]);
      for (const key of candidates) {
        if (Object.hasOwn(step.on, key)) {
          continue;
        }
        for (const level of levels) {
          const matches = rules.policies.filter(
            (policy) =>
              Object.hasOwn(policy.on, key) &&
              policyLevel(policy) === level &&
              policyCovers(policy, step),
          );
          const distinct = new Set(matches.map((policy) => JSON.stringify(policy.on[key])));
          if (matches.length > 1 && distinct.size > 1) {
            const indexes = matches.map((policy) => policy.index);
            const second = indexes[1] as number;
            this.error(
              "conflicting_policy",
              `policies ${indexes.join(" and ")} disagree on '${key}' for step '${step.id}' at the same precedence (${level === "step_id" ? "step ID" : level} level); make one more specific or give them the same action`,
              ["policies", second, "on", key],
            );
          }
        }
      }
    }
  }

  /** Warnings only: unreachable steps and loops that no execution limit bounds. */
  private checkGraph(
    rules: RuleSet,
    steps: ReadonlyMap<string, CompiledStep>,
    stepIds: ReadonlySet<string>,
  ): void {
    if (!stepIds.has(this.doc.start)) {
      return;
    }
    const edges = new Map<string, Set<string>>();
    for (const step of steps.values()) {
      const targets = new Set<string>();
      if (step.kind === "end") {
        edges.set(step.id, targets);
        continue;
      }
      const candidates = [...step.outcomes, ...SYSTEM_OUTCOMES];
      for (const key of candidates) {
        const rule = isSystemOutcome(key)
          ? resolveOutcome(rules, step.id, key, new Set(step.outcomes))
          : lookupExactRule(rules, step.id, key);
        if (rule && rule.action.kind === "goto" && stepIds.has(rule.action.target)) {
          targets.add(rule.action.target);
        }
      }
      edges.set(step.id, targets);
    }

    const reachable = reachableFrom(this.doc.start, edges);
    for (const id of stepIds) {
      if (!reachable.has(id)) {
        this.warn(
          "unreachable_step",
          `step '${id}' cannot be reached from start '${this.doc.start}'`,
          ["steps", id],
        );
      }
    }

    const limited =
      this.doc.limits?.max_step_executions !== undefined ||
      this.doc.limits?.max_wall_time_seconds !== undefined;
    const loops = [...nodesOnCycles(edges)].filter((id) => reachable.has(id)).sort();
    if (loops.length > 0 && !limited) {
      this.warn(
        "unbounded_cycle",
        `steps ${loops.join(", ")} form a loop, and no max_step_executions or max_wall_time_seconds limit is set; the run may repeat forever`,
        ["steps", loops[0] as string],
      );
    }
  }

  private checkTemplate(
    value: string,
    valuePath: DiagnosticPath,
    context: { templated: boolean },
  ): void {
    const scanned = scanPlaceholders(value);
    for (const placeholder of scanned) {
      if (!context.templated) {
        this.error(
          "placeholder_not_allowed",
          `placeholders are not allowed in this field (found ${placeholder.raw})`,
          valuePath,
        );
        return;
      }
      if (placeholder.error) {
        this.error(placeholder.error.code, placeholder.error.message, valuePath);
        continue;
      }
      const ref = placeholder.ref;
      if (!ref) {
        continue;
      }
      if (ref.kind === "task" && !this.doc.tasks) {
        this.error(
          "tasks_required",
          `${placeholder.raw} needs a task source; declare tasks.source`,
          valuePath,
        );
      } else if (ref.kind === "report" || ref.kind === "command_output") {
        this.checkStepReference(
          ref.step,
          ref.kind === "report" ? "agent" : "command",
          placeholder.raw,
          valuePath,
        );
      }
    }
  }

  private checkStepReference(
    stepId: string,
    requiredKind: "agent" | "command",
    raw: string,
    valuePath: DiagnosticPath,
  ): void {
    const target = Object.hasOwn(this.doc.steps, stepId) ? this.doc.steps[stepId] : undefined;
    if (!target) {
      this.error("unknown_step", `${raw} refers to unknown step '${stepId}'`, valuePath);
    } else if (target.kind !== requiredKind) {
      this.error(
        "invalid_placeholder_reference",
        `${raw} must name ${requiredKind === "agent" ? "an agent" : "a command"} step, but '${stepId}' is a ${target.kind} step`,
        valuePath,
      );
    }
  }

  private error(code: DiagnosticCode, message: string, diagnosticPath: DiagnosticPath): void {
    this.add(errorDiagnostic(code, message, diagnosticPath));
  }

  private warn(code: DiagnosticCode, message: string, diagnosticPath: DiagnosticPath): void {
    this.add(warningDiagnostic(code, message, diagnosticPath));
  }

  private add(diagnostic: Diagnostic): void {
    const key = `${diagnostic.severity}|${diagnostic.code}|${JSON.stringify(diagnostic.path)}|${diagnostic.message}`;
    if (this.seenMessages.has(key)) {
      return;
    }
    this.seenMessages.add(key);
    const location = this.options.locate?.(diagnostic.path);
    this.diagnostics.push(location ? { ...diagnostic, location } : diagnostic);
  }
}

function outcomesOf(spec: WorkflowStep): readonly string[] {
  switch (spec.kind) {
    case "agent":
      return spec.outcomes;
    case "command":
      return COMMAND_OUTCOMES;
    case "task.next":
      return TASK_NEXT_OUTCOMES;
    case "task.complete":
      return ["complete"];
    case "end":
      return [];
  }
}

/** Converts validated `on` values into typed actions. The schema guarantees exactly one key. */
function convertOn(on: Readonly<Record<string, unknown>>): Record<string, Action> {
  const result: Record<string, Action> = {};
  for (const [key, value] of Object.entries(on)) {
    result[key] = toAction(value);
  }
  return result;
}

function toAction(value: unknown): Action {
  const fields = value as {
    goto?: string;
    pause?: true;
    retry?: { max_attempts: number; backoff_seconds: number };
  };
  if (fields.goto !== undefined) {
    return { kind: "goto", target: fields.goto };
  }
  if (fields.retry !== undefined) {
    return {
      kind: "retry",
      maxAttempts: fields.retry.max_attempts,
      backoffSeconds: fields.retry.backoff_seconds,
    };
  }
  return { kind: "pause" };
}
