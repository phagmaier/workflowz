/**
 * Child-process supervision (architecture §7).
 *
 * Every child leads its own process group (`detached: true`). That makes ownership unambiguous: a
 * stop, a timeout, or the end of the leader all act on the whole group, so no descendant survives
 * an attempt that the runner has already settled. Termination escalates from SIGTERM to SIGKILL
 * after a grace period, and `completed` resolves only after the group has been reaped.
 *
 * Numeric group IDs are checked against the captured Linux boot/start identity before signalling.
 * Identity mismatch/unavailability leaves settlement uncertain rather than killing an unrelated PID.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, statSync, type WriteStream } from "node:fs";
import type { ProcessIdentity } from "../contracts/process-identity.js";
import { boundedText, OutputCapture } from "./output.js";
import {
  captureProcessIdentity,
  processGroupState,
  requireProcessIdentitySupport,
  signalOwnedGroup,
} from "./process-identity.js";
import { SecretFilter } from "./secrets.js";

export interface ProcessSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs?: number | undefined;
  /** Maximum silence on both stdout and stderr; raw bytes count before scrubbing/capture. */
  readonly idleTimeoutMs?: number | undefined;
  /** Time between SIGTERM and SIGKILL. */
  readonly graceMs?: number | undefined;
  readonly logPath?: string | undefined;
  readonly stdoutLimit?: number | undefined;
  readonly logLimit?: number | undefined;
  readonly stderrLimit?: number | undefined;
  /** Secrets injected by the runner; scrub across arbitrary stream chunk boundaries. */
  readonly secrets?: readonly string[] | undefined;
  /** Optional prompt input; close the pipe after writing it. Other executors keep stdin ignored. */
  readonly stdin?: string | undefined;
  /** Continuous scrubbed output before bounded capture. Observers must not throw. */
  readonly onStdout?: ((chunk: Buffer) => void) | undefined;
}

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly timeoutReason?: "execution" | "idle" | undefined;
  /** True when `terminate()` was called, whether by a stop or by the timeout. */
  readonly terminated: boolean;
  /** Set when the process never started: `cwd_not_found` or a spawn error code such as `ENOENT`. */
  readonly spawnError: string | null;
  readonly pid: number | null;
  readonly stdout: string;
  readonly stdoutTruncated: boolean;
  readonly stderr: string;
  readonly stderrTruncated: boolean;
  readonly stdinError?: string | undefined;
}

export interface RunningProcess {
  readonly pid: number | null;
  readonly processIdentity: ProcessIdentity | null;
  readonly completed: Promise<ProcessResult>;
  /**
   * Ends the process group with SIGTERM, then SIGKILL after the grace period. The returned promise
   * resolves once the process has ended and been reaped. Calling it again is harmless.
   */
  terminate(): Promise<void>;
}

/** A small durable diagnostic head; the capped raw stream log retains the surrounding evidence. */
export function processDiagnostics(result: ProcessResult) {
  const capture = boundedText(result.stderr, 4096);
  return {
    stderr: capture.text,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated || capture.truncated,
  };
}

const DEFAULT_GRACE_MS = 1_000;
const DEFAULT_STDOUT_LIMIT = 64 * 1024;
const DEFAULT_LOG_LIMIT = 16 * 1024 * 1024;
const REAP_WAIT_MS = 2_000;
const STREAM_CLOSE_WAIT_MS = 1_000;
const POLL_MS = 20;

export function startProcess(spec: ProcessSpec): RunningProcess {
  const graceMs = spec.graceMs ?? DEFAULT_GRACE_MS;
  if (!isDirectory(spec.cwd)) {
    return finished({ spawnError: "cwd_not_found", pid: null });
  }
  try {
    requireProcessIdentitySupport();
  } catch {
    return finished({ spawnError: "process_identity_unavailable", pid: null });
  }

  const log =
    spec.logPath === undefined
      ? undefined
      : new LogFile(spec.logPath, spec.logLimit ?? DEFAULT_LOG_LIMIT);
  let child: ChildProcess;
  try {
    child = spawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      env: spec.env,
      detached: true,
      shell: false,
      stdio: [spec.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    void log?.close();
    return finished({ spawnError: errorCode(error), pid: null });
  }
  const output = new OutputCapture(spec.stdoutLimit ?? DEFAULT_STDOUT_LIMIT);
  const stderr = new OutputCapture(spec.stderrLimit ?? DEFAULT_STDOUT_LIMIT);
  const pid = child.pid ?? null;
  const pgid = pid;
  const processIdentity = captureProcessIdentity(pid);

  let terminated = false;
  let timedOut = false;
  let timeoutReason: "execution" | "idle" | undefined;
  let cancelTimeout = () => {};
  let cancelIdle = () => {};
  let settled = false;
  let executionEnded = false;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  let spawnError: string | null = null;
  let stdinError: string | undefined;
  let failTermination: (error: unknown) => void = () => undefined;
  const terminationFailed = new Promise<never>((_, reject) => {
    failTermination = reject;
  });
  child.stdin?.on("error", (error) => {
    stdinError = errorCode(error);
  });
  if (spec.stdin !== undefined) child.stdin?.end(spec.stdin);

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null } | undefined>(
    (resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
      child.once("error", (error) => {
        spawnError = errorCode(error);
        resolve(undefined);
      });
    },
  );
  const streamsClosed = new Promise<void>((resolve) => child.once("close", () => resolve()));

  // A final log filter also catches values reassembled at the stdout/stderr merge boundary.
  const logFilter = new SecretFilter(spec.secrets ?? [], (chunk) => log?.write(chunk));
  const stdoutFilter = new SecretFilter(spec.secrets ?? [], (chunk) => {
    spec.onStdout?.(chunk);
    output.push(chunk);
    logFilter.push(chunk);
  });
  const stderrFilter = new SecretFilter(spec.secrets ?? [], (chunk) => {
    stderr.push(chunk);
    logFilter.push(chunk);
  });
  const activity = () => {
    if (terminated || settled || executionEnded || spec.idleTimeoutMs === undefined) return;
    cancelIdle();
    cancelIdle = deadlineTimer(spec.idleTimeoutMs, () => expire("idle"));
  };
  child.stdout?.on("data", (chunk: Buffer) => {
    activity();
    stdoutFilter.push(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    activity();
    stderrFilter.push(chunk);
  });

  const beginTermination = (): void => {
    if (terminated || settled) {
      return;
    }
    terminated = true;
    cancelTimeout();
    cancelIdle();
    if (pgid === null) {
      return;
    }
    try {
      signalOwnedGroup(pgid, processIdentity, "SIGTERM");
      escalation ??= setTimeout(() => {
        try {
          signalOwnedGroup(pgid, processIdentity, "SIGKILL");
        } catch (error) {
          failTermination(error);
        }
      }, graceMs);
    } catch (error) {
      failTermination(error);
    }
  };

  const expire = (reason: "execution" | "idle") => {
    if (terminated || settled) return;
    timedOut = true;
    timeoutReason = reason;
    beginTermination();
  };
  if (spec.timeoutMs !== undefined)
    cancelTimeout = deadlineTimer(spec.timeoutMs, () => expire("execution"));
  activity();

  const completed = (async (): Promise<ProcessResult> => {
    let exit: Awaited<typeof exited>;
    try {
      exit = await Promise.race([exited, terminationFailed]);
      executionEnded = true;
      cancelTimeout();
      cancelIdle();
      if (pgid !== null) {
        await reapGroup(pgid, processIdentity, graceMs);
      }
      await closeWithin(streamsClosed);
    } catch (error) {
      child.stdout?.destroy();
      child.stderr?.destroy();
      throw error;
    } finally {
      cancelTimeout();
      cancelIdle();
      clearTimeout(escalation);
      stdoutFilter.end();
      stderrFilter.end();
      logFilter.end();
      await log?.close();
      settled = true;
    }
    return {
      exitCode: exit?.code ?? null,
      signal: exit?.signal ?? null,
      timedOut,
      ...(timeoutReason === undefined ? {} : { timeoutReason }),
      terminated,
      spawnError,
      pid,
      stdout: output.text(),
      stdoutTruncated: output.truncated(),
      stderr: stderr.text(),
      stderrTruncated: stderr.truncated(),
      ...(stdinError === undefined ? {} : { stdinError }),
    };
  })();

  return {
    pid,
    processIdentity,
    completed,
    terminate: async () => {
      beginTermination();
      await completed;
    },
  };
}

/** Node clamps oversized delays to 1 ms; long configured timeouts must retain their meaning. */
function deadlineTimer(ms: number, expire: () => void): () => void {
  const deadline = performance.now() + ms;
  let timer: ReturnType<typeof setTimeout>;
  const arm = () => {
    const remaining = deadline - performance.now();
    if (remaining <= 0) expire();
    else timer = setTimeout(arm, Math.min(remaining, 2_147_483_647));
  };
  timer = setTimeout(arm, Math.min(Math.max(0, ms), 2_147_483_647));
  return () => clearTimeout(timer);
}

function finished(result: { spawnError: string; pid: number | null }): RunningProcess {
  const completed: ProcessResult = {
    exitCode: null,
    signal: null,
    timedOut: false,
    terminated: false,
    spawnError: result.spawnError,
    pid: result.pid,
    stdout: "",
    stdoutTruncated: false,
    stderr: "",
    stderrTruncated: false,
  };
  return {
    pid: null,
    processIdentity: null,
    completed: Promise.resolve(completed),
    terminate: async () => undefined,
  };
}

/** Waits for the group to disappear, up to `ms`. Returns whether it is gone. */
async function waitForGroupGone(
  pgid: number,
  identity: ProcessIdentity | null,
  ms: number,
): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    const state = processGroupState(pgid, identity);
    if (state === "gone") return true;
    if (state !== "alive")
      throw new Error(`process group ${pgid} identity is ${state}; settlement is uncertain`);
    if (Date.now() >= deadline) {
      return false;
    }
    await sleep(POLL_MS);
  }
}

/** Ends whatever remains of the group: SIGTERM, a grace period, then SIGKILL. */
async function reapGroup(
  pgid: number,
  identity: ProcessIdentity | null,
  graceMs: number,
): Promise<void> {
  if (processGroupState(pgid, identity) === "gone") return;
  signalOwnedGroup(pgid, identity, "SIGTERM");
  if (await waitForGroupGone(pgid, identity, graceMs)) return;
  signalOwnedGroup(pgid, identity, "SIGKILL");
  if (!(await waitForGroupGone(pgid, identity, REAP_WAIT_MS))) {
    throw new Error(`process group ${pgid} still exists after SIGKILL; settlement is uncertain`);
  }
}

/** Start the drain deadline only after exit and group cleanup, never while the child is running. */
function closeWithin(closed: Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error("process streams remain open after group cleanup; settlement is uncertain"),
        ),
      STREAM_CLOSE_WAIT_MS,
    );
    void closed.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Log writer that stops at `limit` bytes and records that it did. Write errors never reach the caller. */
class LogFile {
  private readonly stream: WriteStream;
  private written = 0;
  private capped = false;

  constructor(
    path: string,
    private readonly limit: number,
  ) {
    this.stream = createWriteStream(path, { flags: "a" });
    this.stream.on("error", () => {
      this.capped = true;
    });
  }

  write(chunk: Buffer): void {
    if (this.capped) {
      return;
    }
    const kept = chunk.subarray(0, this.limit - this.written);
    this.written += kept.length;
    this.stream.write(kept);
    if (kept.length < chunk.length) {
      this.capped = true;
      this.stream.write(`\n[log capped at ${this.limit} bytes]\n`);
    }
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.stream.end(() => resolve());
    });
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "UNKNOWN";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
