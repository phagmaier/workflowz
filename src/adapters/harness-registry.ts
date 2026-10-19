/**
 * Harness registry: a lookup table from `harness` id to what that harness can do (spec §2.4,
 * architecture §4). It is data only. It spawns nothing, so the compiler can depend on it.
 *
 * Adding a harness means adding an entry here and an adapter that passes the conformance suite.
 * An entry's `adapter` status stays `planned` until that suite passes. Run preflight (todo Phase 3)
 * will refuse to start a harness that is still `planned`. Validation in the compiler works with any registry it is given, so
 * tests can use fake harnesses.
 */

export interface HarnessCapabilities {
  readonly supportsResume: boolean;
  readonly supportsEventStream: boolean;
  readonly supportsStructuredFinalOutput: boolean;
  readonly supportsPermissionMode: boolean;
  readonly supportsModelSelection: boolean;
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
 * Capabilities are taken from each CLI's documented headless interface (see
 * docs/harness-compatibility.md). `npm run probe:harnesses` checks that the installed binaries still
 * advertise the flags those claims depend on.
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
    },
  },
  {
    id: "pi",
    product: "Pi coding agent",
    binary: "pi",
    adapter: "planned",
    capabilities: {
      supportsResume: true,
      supportsEventStream: true,
      supportsStructuredFinalOutput: false,
      supportsPermissionMode: false,
      supportsModelSelection: true,
    },
  },
  {
    id: "omp",
    product: "oh-my-pi",
    binary: "omp",
    adapter: "planned",
    capabilities: {
      supportsResume: true,
      supportsEventStream: true,
      supportsStructuredFinalOutput: false,
      supportsPermissionMode: true,
      supportsModelSelection: true,
    },
  },
  {
    id: "opencode",
    product: "OpenCode",
    binary: "opencode",
    adapter: "planned",
    capabilities: {
      supportsResume: true,
      supportsEventStream: true,
      supportsStructuredFinalOutput: false,
      supportsPermissionMode: true,
      supportsModelSelection: true,
    },
  },
  {
    id: "claude",
    product: "Claude Code",
    binary: "claude",
    adapter: "planned",
    capabilities: {
      supportsResume: true,
      supportsEventStream: true,
      supportsStructuredFinalOutput: true,
      supportsPermissionMode: true,
      supportsModelSelection: true,
    },
  },
];

export const BUILT_IN_HARNESSES: HarnessRegistry = new Map(
  BUILT_IN.map((descriptor) => [descriptor.id, descriptor]),
);
