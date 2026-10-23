/**
 * Maps what a process did onto a settlement the coordinator can route (spec §4.3–4.4). These are
 * pure functions over plain results, so the rules are tested without spawning anything.
 *
 * Precedence: a spawn failure beats everything; then a timeout; then a signal or nonzero exit (a
 * crash, which is not a formatting mistake, so it never triggers correction); and only then the
 * report itself. A report from a cleanly exited process is checked against the declared outcomes.
 */

import type { AgentRunResult } from "../adapters/agent-adapter.js";
import type { CommandOutcome } from "../adapters/command-executor.js";
import type { Settlement } from "../engine/run-coordinator.js";

export function settlementForCommand(outcome: CommandOutcome): Settlement {
  switch (outcome.kind) {
    case "outcome":
      return { kind: "outcome", outcome: outcome.outcome };
    case "system":
      return { kind: "system", code: outcome.code, detail: outcome.detail };
    case "terminated":
      return {
        kind: "system",
        code: "system.process_error",
        detail: "command was terminated outside a stop request",
      };
  }
}

export function settlementForAgent(
  result: AgentRunResult,
  allowedOutcomes: readonly string[],
  reportedOutcome: string | null = null,
): Settlement {
  if (result.resumeUnavailable)
    return {
      kind: "system",
      code: "system.resume_unavailable",
      detail: result.spawnError ?? "the persisted agent session is unavailable",
    };
  if (result.completionError)
    return {
      kind: "system",
      code: "system.internal_error",
      detail: "adapter completion failed after confirmed cleanup",
    };
  if (result.spawnError !== null) {
    return {
      kind: "system",
      code: "system.spawn_error",
      detail: `could not start the harness: ${result.spawnError}`,
    };
  }
  if (result.providerError) {
    return {
      kind: "system",
      code: "system.process_error",
      detail: "the harness did not confirm successful execution",
    };
  }
  if (result.timedOut) {
    return {
      kind: "system",
      code: "system.timeout",
      detail:
        result.timeoutReason === "idle"
          ? "the agent exceeded its idle timeout (no stdout/stderr activity)"
          : "the agent exceeded its timeout",
    };
  }
  if (result.terminated) {
    return {
      kind: "system",
      code: "system.process_error",
      detail: "the agent was terminated outside a stop request",
    };
  }
  if (result.signal !== null) {
    return {
      kind: "system",
      code: "system.process_error",
      detail: `the agent was ended by signal ${result.signal}`,
    };
  }
  if (result.exitCode !== 0) {
    return {
      kind: "system",
      code: "system.process_error",
      detail: `the agent exited with status ${result.exitCode}`,
    };
  }
  if (reportedOutcome === null) {
    return {
      kind: "system",
      code: "system.report_error",
      detail: "the agent exited without reporting an outcome",
    };
  }
  if (!allowedOutcomes.includes(reportedOutcome)) {
    return {
      kind: "system",
      code: "system.report_error",
      detail: `'${reportedOutcome}' is not a declared outcome; declared outcomes are ${allowedOutcomes.join(", ")}`,
    };
  }
  return { kind: "outcome", outcome: reportedOutcome };
}
