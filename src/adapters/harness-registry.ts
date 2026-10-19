/**
 * Harness registry: a lookup table from `harness` id to what that harness can do (spec §2.4,
 * architecture §4). It is data only. It spawns nothing, so the compiler can depend on it.
 *
 * Adding a harness means adding an entry here and an adapter that passes the conformance suite.
 * An entry's `adapter` status stays `planned` until that suite passes. Executable adapters are
 * supplied explicitly to RunService, which checks their installed capabilities before invocation.
 * Static validation works with any supplied registry, so tests can use fake harnesses.
 */

export interface HarnessCapabilities {
  readonly supportsResume: boolean;
  readonly supportsEventStream: boolean;
  readonly supportsStructuredFinalOutput: boolean;
  readonly supportsPermissionMode: boolean;
  readonly supportsModelSelection: boolean;
  readonly supportsReasoningEffort: boolean;
}

export type AdapterStatus = "planned" | "conformance_passed";

export interface HarnessDescriptor {
  readonly id: string;
  readonly product: string;
  /** Executable name looked up on PATH. Only the adapter launches it. */
  readonly binary: string;
  readonly capabilities: HarnessCapabilities;
  readonly adapter: AdapterStatus;
}

export type HarnessRegistry = ReadonlyMap<string, HarnessDescriptor>;

/**
 * Static capabilities describe documented harness potential (see docs/harness-compatibility.md).
 * `npm run probe:harnesses` uses execution factories to report the selected installed CLI and
 * implemented transport; those effective snapshots can be narrower than this static metadata.
 */
const BUILT_IN: readonly HarnessDescriptor[] = [
  {
    id: "codex",
    product: "OpenAI Codex CLI",
    binary: "codex",
    adapter: "conformance_passed",
    capabilities: {
      supportsResume: true,
      supportsEventStream: true,
      supportsStructuredFinalOutput: true,
      supportsPermissionMode: true,
      supportsModelSelection: true,
      supportsReasoningEffort: true,
    },
  },
  {
    id: "pi",
    product: "Pi coding agent",
    binary: "pi",
    adapter: "conformance_passed",
    capabilities: {
      supportsResume: true,
      supportsEventStream: true,
      supportsStructuredFinalOutput: false,
      supportsPermissionMode: false,
      supportsModelSelection: true,
      supportsReasoningEffort: true,
    },
  },
  {
    id: "omp",
    product: "oh-my-pi",
    binary: "omp",
    adapter: "conformance_passed",
    capabilities: {
      supportsResume: true,
      supportsEventStream: true,
      supportsStructuredFinalOutput: false,
      supportsPermissionMode: true,
      supportsModelSelection: true,
      supportsReasoningEffort: true,
    },
  },
  {
    id: "opencode",
    product: "OpenCode",
    binary: "opencode",
    adapter: "conformance_passed",
    capabilities: {
      supportsResume: true,
      supportsEventStream: false,
      supportsStructuredFinalOutput: false,
      supportsPermissionMode: true,
      supportsModelSelection: true,
      supportsReasoningEffort: true,
    },
  },
  {
    id: "claude",
    product: "Claude Code",
    binary: "claude",
    adapter: "conformance_passed",
    capabilities: {
      supportsResume: true,
      supportsEventStream: true,
      supportsStructuredFinalOutput: true,
      supportsPermissionMode: true,
      supportsModelSelection: true,
      supportsReasoningEffort: true,
    },
  },
];

export const BUILT_IN_HARNESSES: HarnessRegistry = new Map(
  BUILT_IN.map((descriptor) => [descriptor.id, descriptor]),
);
