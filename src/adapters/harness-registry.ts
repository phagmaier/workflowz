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

/** Runner-selected modes, shared by launch construction, invocation evidence and pre-run disclosure. */
export const PERMISSION_MODES = {
  codex: "dangerously-bypass-approvals-and-sandbox",
  claude: "bypassPermissions",
  omp: "yolo",
  opencode: "session-allow-all",
  pi: "default-unrestricted-tools",
} as const;

export interface HarnessDescriptor {
  readonly id: string;
  readonly product: string;
  /** Executable name looked up on PATH. Only the adapter launches it. */
  readonly binary: string;
  readonly capabilities: HarnessCapabilities;
  readonly adapter: AdapterStatus;
  readonly permissionMode?: string;
}

export type HarnessRegistry = ReadonlyMap<string, HarnessDescriptor>;

/**
 * Static capabilities describe documented harness potential (see docs/reference/harness-compatibility.md).
 * `npm run probe:harnesses` uses execution factories to report the selected installed CLI and
 * implemented transport; those effective snapshots can be narrower than this static metadata.
 */
const BUILT_IN: readonly HarnessDescriptor[] = [
  {
    id: "codex",
    permissionMode: PERMISSION_MODES.codex,
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
    permissionMode: PERMISSION_MODES.pi,
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
    permissionMode: PERMISSION_MODES.omp,
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
    permissionMode: PERMISSION_MODES.opencode,
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
    permissionMode: PERMISSION_MODES.claude,
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
