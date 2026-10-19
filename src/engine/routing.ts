/**
 * Outcome routing (spec §3.3, architecture §3).
 *
 * Precedence for an exact outcome: the step's own `on` > policies targeting the step ID > policies
 * targeting a tag > policies targeting all steps > `defaults.on`. Within one level, two policies
 * that disagree are rejected at compile time, so the first match here is the only match.
 *
 * `system.*` outcomes that have no exact rule fall back to `system.error` through the same levels,
 * and finally to a built-in pause, so an engine error can never be silently accepted.
 */
import { isSystemOutcome, SYSTEM_CATCH_ALL } from "../contracts/identifiers.js";
import type { Action, CompiledPolicy, CompiledStep, ResolvedTransition, RuleSet } from "./model.js";

/** Returns the exact rule for `outcome` with no fallback, or `undefined` if none matches. */
export function lookupExactRule(
  rules: RuleSet,
  stepId: string,
  outcome: string,
): ResolvedTransition | undefined {
  const step = rules.steps.get(stepId);
  if (!step) {
    return undefined;
  }
  const own = step.on[outcome];
  if (own !== undefined) {
    return resolved(outcome, own, { level: "step" }, false);
  }

  const idPolicy = findPolicy(rules.policies, step, outcome, "step_id");
  if (idPolicy) {
    return resolved(
      outcome,
      idPolicy.action,
      { level: "step_id_policy", policyIndex: idPolicy.index },
      false,
    );
  }
  const tagPolicy = findPolicy(rules.policies, step, outcome, "tag");
  if (tagPolicy) {
    return resolved(
      outcome,
      tagPolicy.action,
      { level: "tag_policy", policyIndex: tagPolicy.index },
      false,
    );
  }
  const allPolicy = findPolicy(rules.policies, step, outcome, "all");
  if (allPolicy) {
    return resolved(
      outcome,
      allPolicy.action,
      { level: "all_policy", policyIndex: allPolicy.index },
      false,
    );
  }

  const fallback = rules.defaults[outcome];
  if (fallback !== undefined) {
    return resolved(outcome, fallback, { level: "defaults" }, false);
  }
  return undefined;
}

/**
 * Resolves the transition for a step outcome.
 *
 * Normal outcomes must have an exact rule; the compiler guarantees one for every declared outcome,
 * so a miss here means the caller passed an outcome the step does not declare. That is a programming
 * error and throws rather than picking a route.
 *
 * `system.*` outcomes never throw: they use the catch-all, then the built-in pause.
 */
export function resolveOutcome(
  rules: RuleSet,
  stepId: string,
  outcome: string,
  declaredOutcomes: ReadonlySet<string>,
): ResolvedTransition {
  if (!isSystemOutcome(outcome)) {
    if (!declaredOutcomes.has(outcome)) {
      throw new TypeError(`step '${stepId}' does not declare outcome '${outcome}'`);
    }
    const exact = lookupExactRule(rules, stepId, outcome);
    if (!exact) {
      throw new Error(
        `no transition for outcome '${outcome}' of step '${stepId}'; the compiler should have rejected this`,
      );
    }
    return exact;
  }

  const exact = lookupExactRule(rules, stepId, outcome);
  if (exact) {
    return exact;
  }
  if (outcome !== SYSTEM_CATCH_ALL) {
    const catchAll = lookupExactRule(rules, stepId, SYSTEM_CATCH_ALL);
    if (catchAll) {
      return { ...catchAll, outcome, viaSystemError: true };
    }
  }
  return resolved(outcome, { kind: "pause" }, { level: "built_in_pause" }, false);
}

function resolved(
  outcome: string,
  action: Action,
  source: ResolvedTransition["source"],
  viaSystemError: boolean,
): ResolvedTransition {
  return { outcome, action, source, viaSystemError };
}

/** Whether a policy's selector covers a step. */
export function policyCovers(policy: CompiledPolicy, step: CompiledStep): boolean {
  const match = policy.match;
  if ("all" in match) {
    return true;
  }
  if ("tags" in match) {
    return match.tags.some((tag) => step.tags.includes(tag));
  }
  return match.step_ids.includes(step.id);
}

export type PolicyLevel = "step_id" | "tag" | "all";

/** The precedence level a policy occupies, from its selector. */
export function policyLevel(policy: CompiledPolicy): PolicyLevel {
  if ("all" in policy.match) {
    return "all";
  }
  return "tags" in policy.match ? "tag" : "step_id";
}

function findPolicy(
  policies: readonly CompiledPolicy[],
  step: CompiledStep,
  outcome: string,
  level: PolicyLevel,
): { index: number; action: Action } | undefined {
  for (const policy of policies) {
    const action = policy.on[outcome];
    if (action !== undefined && policyLevel(policy) === level && policyCovers(policy, step)) {
      return { index: policy.index, action };
    }
  }
  return undefined;
}
