import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { childEnvironment } from "../adapters/environment.js";
import { observeProcessGroup, signalOwnedGroup } from "../adapters/process-identity.js";
import { RunCoordinator } from "../engine/run-coordinator.js";
import { WorkflowDatabase } from "../store/database.js";
import { REPO_ROOT } from "./paths.js";

export type RecoveryScenario =
  | "command"
  | "agent"
  | "correction"
  | "between"
  | "correction-intent"
  | "stubborn"
  | "termination-request"
  | "termination-finish";
const readySchema = z.object({ runId: z.string().startsWith("run_") }).strict();

export interface RecoveryFixture {
  readonly file: string;
  readonly runId: string;
  crash(): Promise<void>;
  cleanup(): Promise<void>;
}

export async function untilRecovery(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("recovery fixture condition was not reached");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Real owner process; SIGKILL is deliberate crash injection, not the runner's stop path. */
export async function startRecoveryFixture(
  root: string,
  scenario: RecoveryScenario,
): Promise<RecoveryFixture> {
  const file = path.join(root, "state.sqlite");
  const child = fork(path.join(REPO_ROOT, "test/fixtures/recovery-runner.mjs"), [root, scenario], {
    execPath: process.execPath,
    env: childEnvironment(),
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(0, 4096);
  });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("exit", () => resolve());
    child.once("error", reject);
  });
  const crash = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  };
  const cleanup = async () => {
    await crash();
    if (!existsSync(file)) return;
    const reader = new WorkflowDatabase(file, { readOnly: true });
    try {
      const row = reader.prepare("SELECT run_id FROM runs LIMIT 1").get();
      if (!row || typeof row["run_id"] !== "string") return;
      const state = new RunCoordinator(reader).inspect(row["run_id"]);
      const identity = state.attempts.at(-1)?.processIdentity;
      if (!identity) return;
      const status = observeProcessGroup(identity);
      if (status === "alive") signalOwnedGroup(identity.pid, identity, "SIGKILL");
      else if (status !== "gone")
        throw new Error("fixture cleanup could not verify process ownership");
      await untilRecovery(() => observeProcessGroup(identity) === "gone");
    } finally {
      reader.close();
    }
  };
  try {
    const runId = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`recovery fixture startup timed out: ${stderr}`)),
        10000,
      );
      child.once("message", (message) => {
        clearTimeout(timer);
        const ready = readySchema.safeParse(message);
        if (ready.success) resolve(ready.data.runId);
        else reject(new Error("invalid recovery fixture readiness"));
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(`recovery fixture exited before readiness: ${stderr}`));
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    return { file, runId, crash, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
