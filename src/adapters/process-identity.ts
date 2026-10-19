/**
 * Linux process-group admission. Never signal a numeric group whose current identity contradicts
 * the captured boot/start identity. /proc checks and kill are not atomic (no pidfd API in Node).
 * A departed leader's group ID stays reserved while members remain; validate their session/start
 * bounds too. Escaped sessions are not discoverable: this is ownership evidence, not isolation.
 */
import { readdirSync, readFileSync } from "node:fs";
import type { ProcessIdentity, ProcessObservation } from "../contracts/process-identity.js";

let bootId: string | undefined;

function currentBoot(): string {
  if (process.platform !== "linux") throw new Error("process identity requires Linux /proc");
  bootId ??= readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  return bootId;
}

/** Check before spawn, so an unsupported host never launches a child it cannot safely supervise. */
export function requireProcessIdentitySupport(): void {
  currentBoot();
}

/** comm may contain spaces, parentheses and newlines; fields begin after its final close paren. */
export function parseProcessStat(text: string): Omit<ProcessIdentity, "bootId"> {
  const end = text.lastIndexOf(")");
  const pid = Number(text.slice(0, text.indexOf(" ")));
  const fields = text
    .slice(end + 2)
    .trimEnd()
    .split(" ");
  const pgid = Number(fields[2]);
  const sid = Number(fields[3]);
  const startTicks = fields[19];
  if (
    end < 0 ||
    !Number.isSafeInteger(pid) ||
    pid < 1 ||
    !Number.isSafeInteger(pgid) ||
    pgid < 0 ||
    !Number.isSafeInteger(sid) ||
    sid < 0 ||
    !startTicks ||
    !/^[0-9]+$/.test(startTicks)
  )
    throw new Error("invalid process identity record");
  return { pid, pgid, sid, startTicks };
}

function snapshot(pid: number): ProcessIdentity | undefined {
  try {
    return {
      ...parseProcessStat(readFileSync(`/proc/${pid}/stat`, "utf8")),
      bootId: currentBoot(),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ESRCH")
    )
      return undefined;
    throw error;
  }
}

/** Capture immediately after spawn, before yielding. An unavailable identity cannot authorize signals. */
export function captureProcessIdentity(pid: number | null): ProcessIdentity | null {
  if (pid === null || pid < 2) return null;
  try {
    const found = snapshot(pid);
    return found?.pid === pid && found.pgid === pid && found.sid === pid ? found : null;
  } catch {
    return null;
  }
}

function groupExists(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    throw error;
  }
}

export function observeProcessGroup(identity: ProcessIdentity | null): ProcessObservation {
  if (!identity || identity.pid !== identity.pgid || identity.pid !== identity.sid)
    return "unknown";
  try {
    if (identity.bootId !== currentBoot()) return "gone";
    if (!groupExists(identity.pgid)) return "gone";
    const leader = snapshot(identity.pid);
    if (leader)
      return leader.startTicks === identity.startTicks &&
        leader.pgid === identity.pgid &&
        leader.sid === identity.sid
        ? "alive"
        : "mismatch";
    // A live descendant can outlast its reaped leader. Do not guess from kill(-pgid, 0) alone.
    let member = false;
    for (const name of readdirSync("/proc")) {
      if (!/^[0-9]+$/.test(name)) continue;
      const found = snapshot(Number(name));
      if (found?.pgid !== identity.pgid) continue;
      if (found.sid !== identity.sid || BigInt(found.startTicks) < BigInt(identity.startTicks))
        return "mismatch";
      member = true;
    }
    return member ? "alive" : groupExists(identity.pgid) ? "unknown" : "gone";
  } catch {
    return "unknown";
  }
}

/** The PID fallback can prove absence, never ownership. Used only if capture lost a short-lived child. */
export function processGroupState(
  pid: number,
  identity: ProcessIdentity | null,
): ProcessObservation {
  if (identity) return identity.pid === pid ? observeProcessGroup(identity) : "mismatch";
  try {
    return groupExists(pid) ? "unknown" : "gone";
  } catch {
    return "unknown";
  }
}

export function signalOwnedGroup(
  pid: number,
  identity: ProcessIdentity | null,
  signal: NodeJS.Signals,
): void {
  const state = processGroupState(pid, identity);
  if (state === "gone") return;
  if (state !== "alive")
    throw new Error(`process group ${pid} identity is ${state}; settlement is uncertain`);
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error;
  }
}
