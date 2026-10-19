/**
 * Names shared by step IDs, outcome names, and tags.
 *
 * Identifiers are lowercase snake_case with no dots, braces, or spaces. That keeps the
 * placeholder grammar (`{{reports.<step_id>.summary}}`) unambiguous and makes it impossible
 * for a user-declared name to imitate an engine-reserved `system.*` outcome.
 */
export const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export function isIdentifier(value: string): boolean {
  return IDENTIFIER_PATTERN.test(value);
}

/**
 * Outcomes produced by the engine itself. Agents and commands can never declare these; a
 * workflow may only route them. `system.error` is the catch-all for any engine error that has
 * no more specific transition (spec §3.3, §5).
 */
export const SYSTEM_OUTCOMES = [
  "system.error",
  "system.spawn_error",
  "system.process_error",
  "system.timeout",
  "system.report_error",
  "system.resume_unavailable",
  "system.task_state_error",
  "system.retry_exhausted",
  "system.interrupted",
  "system.internal_error",
] as const;

export type SystemOutcome = (typeof SYSTEM_OUTCOMES)[number];

export const SYSTEM_CATCH_ALL: SystemOutcome = "system.error";

const SYSTEM_OUTCOME_SET: ReadonlySet<string> = new Set(SYSTEM_OUTCOMES);

export function isSystemOutcome(name: string): name is SystemOutcome {
  return SYSTEM_OUTCOME_SET.has(name);
}

/** Any name in the reserved `system.` namespace, known or not. */
export function isReservedName(name: string): boolean {
  return name.startsWith("system.");
}
