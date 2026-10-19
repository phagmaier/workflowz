/**
 * Child-process supervision (architecture §7).
 *
 * Every child leads its own process group (`detached: true`). That makes ownership unambiguous: a
 * stop, a timeout, or the end of the leader all act on the whole group, so no descendant survives
 * an attempt that the runner has already settled. Termination escalates from SIGTERM to SIGKILL
 * after a grace period, and `completed` resolves only after the group has been reaped.
 *
 * Known limit: the group id is the leader's pid. If the leader is gone and its pid is reused while
 * group members still exist, signals could reach the wrong group. Phase 7 adds process-start
 * identity checks; until then this window is documented, not hidden.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, statSync, type WriteStream } from "node:fs";
import { OutputCapture } from "./output.js";

export interface ProcessSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs?: number | undefined;
  /** Time between SIGTERM and SIGKILL. */
  readonly graceMs?: number | undefined;
  readonly logPath?: string | undefined;
  readonly stdoutLimit?: number | undefined;
  readonly logLimit?: number | undefined;
}

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  /** True when `terminate()` was called, whether by a stop or by the timeout. */
  readonly terminated: boolean;
  /** Set when the process never started: `cwd_not_found` or a spawn error code such as `ENOENT`. */
  readonly spawnError: string | null;
  readonly pid: number | null;
  readonly stdout: string;
  readonly stdoutTruncated: boolean;
}

export interface RunningProcess {
  readonly pid: number | null;
  readonly completed: Promise<ProcessResult>;
  /**
   * Ends the process group with SIGTERM, then SIGKILL after the grace period. The returned promise
   * resolves once the process has ended and been reaped. Calling it again is harmless.
   */
  terminate(): Promise<void>;
}

const DEFAULT_GRACE_MS = 1_000;
const DEFAULT_STDOUT_LIMIT = 64 * 1024;
const DEFAULT_LOG_LIMIT = 16 * 1024 * 1024;
const STREAM_CLOSE_WAIT_MS = 1_000;
const REAP_WAIT_MS = 2_000;
const POLL_MS = 20;

export function startProcess(spec: ProcessSpec): RunningProcess {
  const graceMs = spec.graceMs ?? DEFAULT_GRACE_MS;
  if (!isDirectory(spec.cwd)) {
    return finished({ spawnError: "cwd_not_found", pid: null });
  }

  const output = new OutputCapture(spec.stdoutLimit ?? DEFAULT_STDOUT_LIMIT);
  const log =
    spec.logPath === undefined
      ? undefined
      : new LogFile(spec.logPath, spec.logLimit ?? DEFAULT_LOG_LIMIT);

  const child = spawn(spec.command, [...spec.args], {
    cwd: spec.cwd,
    env: spec.env,
    detached: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const pid = child.pid ?? null;
  const pgid = pid;

  let terminated = false;
  let timedOut = false;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  let spawnError: string | null = null;

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null } | undefined>(
    (resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
      child.once("error", (error) => {
        spawnError = errorCode(error);
        resolve(undefined);
      });
    },
  );
  const streamsClosed = closeWithin(child, STREAM_CLOSE_WAIT_MS);

  child.stdout?.on("data", (chunk: Buffer) => {
    output.push(chunk);
    log?.write(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => log?.write(chunk));

  const beginTermination = (): void => {
    terminated = true;
    if (pgid === null) {
      return;
    }
    signalGroup(pgid, "SIGTERM");
    escalation ??= setTimeout(() => signalGroup(pgid, "SIGKILL"), graceMs);
  };

  const timer =
    spec.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          beginTermination();
        }, spec.timeoutMs);

  const completed = (async (): Promise<ProcessResult> => {
    const exit = await exited;
    if (timer) {
      clearTimeout(timer);
    }
    if (pgid !== null) {
      await reapGroup(pgid, graceMs);
    }
    if (escalation) {
      clearTimeout(escalation);
    }
    await streamsClosed;
    await log?.close();
    return {
      exitCode: exit?.code ?? null,
      signal: exit?.signal ?? null,
      timedOut,
      terminated,
      spawnError,
      pid,
      stdout: output.text(),
      stdoutTruncated: output.truncated(),
    };
  })();

  return {
    pid,
    completed,
    terminate: async () => {
      beginTermination();
      await completed;
    },
  };
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
  };
  return { pid: null, completed: Promise.resolve(completed), terminate: async () => undefined };
}

/** Sends `signal` to the group. A group that has already gone is not an error. */
function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch (error) {
    if (errorCode(error) !== "ESRCH") {
      throw error;
    }
  }
}

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    // EPERM means the group exists but belongs to someone else, so it still counts as alive.
    return errorCode(error) === "EPERM";
  }
}

/** Waits for the group to disappear, up to `ms`. Returns whether it is gone. */
async function waitForGroupGone(pgid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (groupAlive(pgid)) {
    if (Date.now() >= deadline) {
      return false;
    }
    await sleep(POLL_MS);
  }
  return true;
}

/** Ends whatever remains of the group: SIGTERM, a grace period, then SIGKILL. */
async function reapGroup(pgid: number, graceMs: number): Promise<void> {
  if (!groupAlive(pgid)) {
    return;
  }
  signalGroup(pgid, "SIGTERM");
  if (await waitForGroupGone(pgid, graceMs)) {
    return;
  }
  signalGroup(pgid, "SIGKILL");
  await waitForGroupGone(pgid, REAP_WAIT_MS);
}

function closeWithin(child: ChildProcess, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    child.once("close", () => {
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
    if (this.written + chunk.length > this.limit) {
      this.capped = true;
      this.stream.write(`\n[log capped at ${this.limit} bytes]\n`);
      return;
    }
    this.written += chunk.length;
    this.stream.write(chunk);
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
