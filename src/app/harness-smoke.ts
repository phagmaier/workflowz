/** Opt-in developer smoke, not a management CLI. The ordinary runner owns all execution/reporting. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stringify } from "yaml";
import type { AgentAdapter, AgentHandle, AgentInput } from "../adapters/agent-adapter.js";
import type { CodexAdapterOptions } from "../adapters/codex.js";
import { childEnvironment } from "../adapters/environment.js";
import { BUILT_IN_HARNESSES } from "../adapters/harness-registry.js";
import { CapabilityProbeError, createInstalledAdapter } from "../adapters/probe.js";
import { startProcess } from "../adapters/process.js";
import { environmentSecrets } from "../adapters/secrets.js";
import { RunService } from "../runner/run-service.js";
import { WorkflowDatabase } from "../store/database.js";

export interface SmokeSelection {
  readonly execute: boolean;
  readonly harness: string;
  readonly model: string;
  readonly scenario: "report" | "correction";
  readonly timeoutSeconds: number;
  readonly artifactsDir: string;
  readonly reasoningEffort?: string;
}

/** No defaults for provider/model/scenario/time/artifacts; even plan mode is deliberate. */
export function parseSmokeSelection(args: readonly string[]): SmokeSelection {
  const values = new Map<string, string>();
  let execute = false;
  const allowed: Record<string, true> = {
    harness: true,
    model: true,
    scenario: true,
    "timeout-seconds": true,
    "artifacts-dir": true,
    "reasoning-effort": true,
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--execute" && !execute) {
      execute = true;
      continue;
    }
    const key = arg?.slice(2);
    const value = args[++index];
    if (
      !arg?.startsWith("--") ||
      !key ||
      !Object.hasOwn(allowed, key) ||
      values.has(key) ||
      !value ||
      value.startsWith("--") ||
      [...value].some((character) => character.charCodeAt(0) < 32)
    )
      throw new Error("invalid, duplicate or incomplete smoke option; see --help");
    values.set(key, value);
  }
  const harness = values.get("harness");
  const model = values.get("model");
  const scenario = values.get("scenario");
  const timeoutSeconds = Number(values.get("timeout-seconds"));
  const artifactsDir = values.get("artifacts-dir");
  if (!harness || !BUILT_IN_HARNESSES.has(harness))
    throw new Error("select one registered --harness");
  if (!model?.trim()) throw new Error("an explicit --model is required");
  if (scenario !== "report" && scenario !== "correction")
    throw new Error("--scenario must be report or correction");
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 300)
    throw new Error("--timeout-seconds must be an integer from 1 to 300");
  if (!artifactsDir || !path.isAbsolute(artifactsDir))
    throw new Error("--artifacts-dir must be absolute");
  const reasoningEffort = values.get("reasoning-effort");
  return {
    execute,
    harness,
    model,
    scenario,
    timeoutSeconds,
    artifactsDir,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

export function smokePlan(selection: SmokeSelection) {
  return {
    ...selection,
    maximumInvocations: selection.scenario === "correction" ? 2 : 1,
    correctionTimeoutSeconds: Math.min(selection.timeoutSeconds, 30),
    spendingCap: "none; time bounds do not cap billing or harness-native retries",
    authentication:
      "normal local discovery; status output discarded; no login or credential-file inspection",
  };
}

type Authentication =
  | "available"
  | "unavailable"
  | "status_unsupported"
  | "status_failed"
  | "cleanup_uncertain";
type Category =
  | "passed"
  | "unsupported_capability"
  | "authentication_unavailable"
  | "authentication_check_failed"
  | "provider_failure"
  | "execution_failure"
  | "smoke_assertion_failure"
  | "cleanup_uncertain";

/** No raw process handles, report access, CLI output, auth payloads or inspected run state here. */
export interface SmokeEvidence {
  readonly harness: string;
  readonly scenario: string;
  readonly model: string;
  readonly reasoningEffort?: string;
  category: Category;
  authentication?: Authentication;
  version?: string;
  capabilities?: AgentAdapter["capabilities"];
  permissionModes?: string[];
  outcome?: string;
  sessionFingerprints?: string[];
  correctionCount?: number;
  invocationCount?: number;
  durableReopen?: boolean;
  acknowledgment?: boolean;
  projectRemoved?: boolean;
  artifactRoot: string;
}

interface SmokeDependencies {
  /** Offline tests supply actual factory options and synthetic CLIs; the public command has no override. */
  readonly adapterOptions?: CodexAdapterOptions;
  readonly authentication?: (selection: SmokeSelection, project: string) => Promise<Authentication>;
  readonly signal?: AbortSignal;
}

/** Documented harness-owned checks only. Never use credential-printing commands or refresh Pi auth. */
export async function checkSmokeAuthentication(
  selection: SmokeSelection,
  project: string,
  options: CodexAdapterOptions = {},
): Promise<Authentication> {
  const source = options.environment ?? process.env;
  const names =
    selection.harness === "codex"
      ? ["CODEX_HOME", "CODEX_API_KEY"]
      : selection.harness === "claude"
        ? [
            "CLAUDE_CONFIG_DIR",
            "CLAUDE_CODE_OAUTH_TOKEN",
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "ANTHROPIC_BASE_URL",
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
          ]
        : [
            "PI_CODING_AGENT_DIR",
            "PI_OFFLINE",
            "PI_TELEMETRY",
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "ANTHROPIC_OAUTH_TOKEN",
            "GEMINI_API_KEY",
            "OPENROUTER_API_KEY",
          ];
  const args =
    selection.harness === "codex"
      ? ["login", "status"]
      : selection.harness === "claude"
        ? ["auth", "status"]
        : selection.harness === "pi"
          ? ["auth", "check", "--model", selection.model, "--no-refresh"]
          : undefined;
  if (!args) return "status_unsupported";
  const env = childEnvironment(
    Object.fromEntries(
      names
        .filter((name) => source[name] !== undefined)
        .map((name) => [name, source[name] as string]),
    ),
    source,
  );
  // Capture limits of zero deliberately discard both channels, including account-identifying output.
  try {
    const result = await startProcess({
      command: options.binary ?? selection.harness,
      args: [...(options.prefixArgs ?? []), ...args],
      cwd: project,
      env,
      secrets: environmentSecrets(env),
      timeoutMs: 15_000,
      stdoutLimit: 0,
      stderrLimit: 0,
    }).completed;
    if (result.spawnError || result.signal || result.timedOut) return "status_failed";
    return result.exitCode === 0
      ? "available"
      : result.exitCode === 1
        ? "unavailable"
        : "status_failed";
  } catch {
    return "cleanup_uncertain";
  }
}

export async function runHarnessSmoke(
  selection: SmokeSelection,
  dependencies: SmokeDependencies = {},
): Promise<SmokeEvidence> {
  // Admission is enforced here too, not just by the command-line parser. No probes or filesystem writes before it.
  if (!selection.execute)
    throw new Error("provider execution requires explicit --execute authorization");
  const descriptor = BUILT_IN_HARNESSES.get(selection.harness);
  if (!descriptor) throw new Error("unknown smoke harness");
  mkdirSync(selection.artifactsDir, { recursive: true, mode: 0o700 });
  const root = mkdtempSync(
    path.join(selection.artifactsDir, `wf-${selection.harness}-${selection.scenario}-`),
  );
  const project = path.join(root, "project");
  const logDir = path.join(root, "logs");
  mkdirSync(project, { mode: 0o700 });
  const evidence: SmokeEvidence = {
    harness: selection.harness,
    model: selection.model,
    scenario: selection.scenario,
    ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
    category: "smoke_assertion_failure",
    artifactRoot: root,
  };
  let database: WorkflowDatabase | undefined;
  let service: RunService | undefined;
  let runId: string | undefined;
  let uncertain = false;
  let operationSettled = false;
  let providerFailure = false;
  const observe = (handle: AgentHandle): AgentHandle => ({
    ...handle,
    completed: handle.completed.then((result) => {
      providerFailure ||= result.providerError !== undefined;
      return result;
    }),
  });
  let stopping: Promise<void> | undefined;
  const stop = () => {
    if (service && runId && !stopping) {
      stopping = service.stop(runId, "smoke interrupted");
      // Attach immediately; await the original promise before closing the database below.
      void stopping.catch(() => {
        uncertain = true;
      });
    }
  };
  try {
    const adapter = await createInstalledAdapter(descriptor, dependencies.adapterOptions);
    evidence.version = adapter.compatibility.version;
    evidence.capabilities = adapter.capabilities;
    if (
      !adapter.capabilities.supportsModelSelection ||
      (selection.reasoningEffort && !adapter.capabilities.supportsReasoningEffort) ||
      (selection.scenario === "correction" &&
        (!adapter.capabilities.supportsResume || !adapter.resumeForReportCorrection))
    ) {
      evidence.category = "unsupported_capability";
      return evidence;
    }
    evidence.authentication = await (dependencies.authentication ?? checkSmokeAuthentication)(
      selection,
      project,
    );
    if (evidence.authentication === "cleanup_uncertain") {
      uncertain = true;
      evidence.category = "cleanup_uncertain";
      return evidence;
    }
    if (evidence.authentication === "unavailable" || evidence.authentication === "status_failed") {
      evidence.category =
        evidence.authentication === "unavailable"
          ? "authentication_unavailable"
          : "authentication_check_failed";
      return evidence;
    }
    if (dependencies.signal?.aborted) {
      evidence.category = "execution_failure";
      return evidence;
    }
    const summary = `workflowz-smoke-${randomUUID()}`;
    // This helper observes the real wf acknowledgment, not model text claiming a successful report.
    writeFileSync(
      path.join(project, "smoke-report.mjs"),
      `import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
const result = spawnSync('wf', ['report', 'complete', '--summary', ${JSON.stringify(summary)}], {stdio: 'ignore', timeout: 10000});
if (result.status !== 0 || result.error) process.exit(1);
writeFileSync('acknowledged', 'wf exit 0');
await setTimeout(200);
`,
    );
    const command = `'${process.execPath.replaceAll("'", "'\\''")}' smoke-report.mjs`;
    const reportPrompt = `Minimal reporting smoke. Run exactly this shell command in the current directory: ${command}. Wait for exit 0, then finish. Do not read credentials, print environment, edit files, delegate, or do other work. The helper submits the only report and records acknowledgment.`;
    const freshPrompt =
      selection.scenario === "report"
        ? reportPrompt
        : "Deliberate missing-report correction smoke. This first turn must end cleanly WITHOUT calling wf report or any tools. Reply READY only. A report-only follow-up will resume this exact session. Do not modify files or delegate.";
    // Smoke-only prompt control deliberately induces correction; no product policy/transport changes.
    const resume = adapter.resumeForReportCorrection;
    const wrapped: AgentAdapter = {
      id: adapter.id,
      capabilities: adapter.capabilities,
      start: (input: AgentInput) =>
        observe(adapter.start({ ...input, prompt: freshPrompt, context: undefined })),
      ...(resume
        ? {
            resumeForReportCorrection: (input: AgentInput & { readonly priorSessionId: string }) =>
              observe(
                resume({
                  ...input,
                  prompt: `${input.prompt}\n${reportPrompt}`,
                  context: undefined,
                }),
              ),
          }
        : {}),
    };
    const dbPath = path.join(root, "state.sqlite");
    database = new WorkflowDatabase(dbPath);
    service = new RunService(database, {
      agents: new Map([[adapter.id, wrapped]]),
      logDir,
      correctionTimeoutMs: Math.min(selection.timeoutSeconds * 1000, 30_000),
    });
    runId = service.createRun({
      workflowDir: project,
      workflowText: stringify({
        version: 1,
        name: "Opt-in harness smoke",
        project: { root: "." },
        start: "work",
        defaults: { report_correction_attempts: selection.scenario === "correction" ? 1 : 0 },
        steps: {
          work: {
            kind: "agent",
            harness: adapter.id,
            model: selection.model,
            ...(selection.reasoningEffort ? { reasoning_effort: selection.reasoningEffort } : {}),
            session: "fresh",
            timeout_seconds: selection.timeoutSeconds,
            prompt: freshPrompt,
            outcomes: ["complete"],
            on: { complete: { goto: "done" } },
          },
          done: { kind: "end" },
        },
      }),
    });
    dependencies.signal?.addEventListener("abort", stop, { once: true });
    service.coordinator.start(runId);
    const driving = service.drive(runId);
    if (dependencies.signal?.aborted) stop();
    await driving;
    if (stopping) await stopping;
    const state = service.coordinator.inspect(runId);
    uncertain = service.coordinator.activeAttempt(runId) !== undefined;
    if (uncertain) {
      evidence.category = "cleanup_uncertain";
      return evidence;
    }
    operationSettled = true;
    const invocations = state.events.filter((event) => event.type.startsWith("invocation_"));
    const starts = invocations.filter((event) => event.type === "invocation_started");
    const settled = invocations.filter((event) => event.type === "invocation_settled");
    evidence.invocationCount = starts.length;
    evidence.correctionCount = state.attempts[0]?.correctionCount ?? 0;
    evidence.permissionModes = starts.flatMap((event) =>
      typeof event.data.permissionMode === "string" ? [event.data.permissionMode] : [],
    );
    evidence.outcome = state.transitions[0]?.outcome ?? state.run.status;
    evidence.sessionFingerprints = settled.flatMap((event) =>
      typeof event.data.sessionId === "string"
        ? [createHash("sha256").update(event.data.sessionId).digest("hex")]
        : [],
    );
    evidence.acknowledgment =
      existsSync(path.join(project, "acknowledged")) &&
      readFileSync(path.join(project, "acknowledged"), "utf8") === "wf exit 0";
    if (evidence.outcome !== "complete") {
      evidence.category = providerFailure ? "provider_failure" : "execution_failure";
      return evidence;
    }
    const expected = selection.scenario === "correction" ? 2 : 1;
    assert.equal(state.run.status, "completed");
    assert.equal(state.attempts.length, 1);
    assert.equal(evidence.acknowledgment, true);
    const attempt = state.attempts[0];
    assert.ok(attempt);
    assert.equal(service.coordinator.reportFor(attempt.attemptId)?.summary, summary);
    assert.equal(state.events.filter((event) => event.type === "report_accepted").length, 1);
    assert.equal(evidence.correctionCount, expected - 1);
    assert.equal(starts.length, expected);
    assert.deepEqual(
      invocations.map((event) => event.type),
      Array.from({ length: expected }, () => ["invocation_started", "invocation_settled"]).flat(),
    );
    for (const event of settled) {
      assert.equal(event.data.exitCode, 0);
      assert.equal(event.data.timedOut, false);
      assert.ok(event.data.sessionId);
      assert.equal(event.data.failure, undefined);
    }
    if (expected === 2) {
      assert.equal(settled[0]?.data.sessionId, starts[1]?.data.sessionId);
      assert.equal(settled[0]?.data.sessionId, settled[1]?.data.sessionId);
    }
    const accepted = state.events.find((event) => event.type === "report_accepted");
    const finalSettlement = settled.at(-1);
    assert.ok(accepted && finalSettlement);
    assert.ok(accepted.eventId < finalSettlement.eventId);
    database.close();
    database = new WorkflowDatabase(dbPath);
    const reopened = new RunService(database, { agents: new Map(), logDir }).coordinator;
    assert.equal(reopened.inspect(runId).run.status, "completed");
    assert.equal(reopened.reportFor(attempt.attemptId)?.summary, summary);
    assert.deepEqual(reopened.inspect(runId).attempts, state.attempts);
    evidence.durableReopen = true;
    evidence.category = "passed";
    return evidence;
  } catch (error) {
    try {
      if (!operationSettled && service && runId && service.coordinator.activeAttempt(runId))
        uncertain = true;
    } catch {
      // Failed database inspection cannot establish that an operation settled.
      uncertain = true;
    }
    evidence.category = uncertain
      ? "cleanup_uncertain"
      : error instanceof CapabilityProbeError
        ? "unsupported_capability"
        : "smoke_assertion_failure";
    return evidence;
  } finally {
    dependencies.signal?.removeEventListener("abort", stop);
    if (stopping) {
      try {
        await stopping;
      } catch {
        uncertain = true;
      }
    }
    try {
      database?.close();
    } catch {
      uncertain = true;
    }
    if (!uncertain) {
      try {
        rmSync(project, { recursive: true, force: true });
        evidence.projectRemoved = true;
      } catch {
        uncertain = true;
      }
    }
    if (uncertain) evidence.category = "cleanup_uncertain";
    writeFileSync(path.join(root, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, {
      mode: 0o600,
    });
  }
}
