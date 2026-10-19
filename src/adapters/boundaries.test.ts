import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { RunService } from "../runner/run-service.js";
import { WorkflowDatabase } from "../store/database.js";
import { REPO_ROOT } from "../test-support/paths.js";
import type { AgentAdapter, AgentInput } from "./agent-adapter.js";
import { createClaudeAdapter } from "./claude.js";
import { createCodexAdapter } from "./codex.js";
import { createOmpAdapter } from "./omp.js";
import { createOpenCodeAdapter } from "./opencode.js";
import { createPiAdapter } from "./pi.js";
import { startProcess } from "./process.js";

const KEY = 'synthetic-provider-"boundary\\/ +🙂';
const RETIRED = "synthetic-retired-report-credential";
const factories = {
  codex: [createCodexAdapter, "CODEX_HOME", "CODEX_API_KEY"],
  pi: [createPiAdapter, "PI_CODING_AGENT_DIR", "OPENAI_API_KEY"],
  omp: [createOmpAdapter, "PI_CODING_AGENT_DIR", "OMP_AUTH_BROKER_TOKEN"],
  claude: [createClaudeAdapter, "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN"],
  opencode: [createOpenCodeAdapter, "OPENCODE_CONFIG_DIR", "ANTHROPIC_AUTH_TOKEN"],
} as const;

function assertScrubbed(text: string, secrets: readonly string[]) {
  for (const secret of secrets) {
    for (const form of [
      secret,
      JSON.stringify(secret).slice(1, -1),
      encodeURIComponent(secret),
      Buffer.from(secret).toString("base64"),
      Buffer.from(secret).toString("base64url"),
    ])
      assert.equal(
        text.includes(form),
        false,
        "known credential representation reached boundary evidence",
      );
  }
}

describe("adapter environment and diagnostic boundaries", () => {
  for (const [id, [factory, configName, keyName]] of Object.entries(factories)) {
    for (const mode of ["report", "provider-error", "crash"]) {
      it(`${id}: ${mode} retains scrubbed evidence and useful bounded diagnostics`, async () => {
        const root = mkdtempSync(path.join(os.tmpdir(), "wf-boundaries-"));
        const database = new WorkflowDatabase(path.join(root, "state.sqlite"));
        try {
          const config = path.join(root, "fixture.json");
          const capture = path.join(root, "capture.json");
          writeFileSync(
            config,
            JSON.stringify({
              plan: [{ mode }],
              capture,
              options: { boundary: true, boundaryLarge: true, retiredSecrets: [RETIRED] },
            }),
          );
          const adapter = await factory({
            binary: process.execPath,
            prefixArgs: [path.join(REPO_ROOT, `test/fixtures/fake-${id}.mjs`), config],
            environment: {
              PATH: process.env.PATH,
              HOME: root,
              [configName]: root,
              [keyName]: KEY,
              NODE_OPTIONS: "--not-a-real-node-option",
              CLAUDECODE: "nested parent",
              GITHUB_TOKEN: "unrelated-parent-credential",
              WF_REPORT_TOKEN: "stale-parent-report-credential",
              UNRELATED_PARENT: "withheld",
            },
          });
          const inputs: AgentInput[] = [];
          const wrapped: AgentAdapter = {
            id: adapter.id,
            capabilities: adapter.capabilities,
            start(input) {
              inputs.push(input);
              const access = input.reportAccess;
              assert.ok(access?.secrets);
              return adapter.start({
                ...input,
                reportAccess: {
                  ...access,
                  secrets: [...access.secrets, RETIRED],
                },
              });
            },
          };
          const service = new RunService(database, {
            agents: new Map([[id, wrapped]]),
            logDir: path.join(root, "logs"),
          });
          const runId = service.createRun({
            workflowDir: root,
            workflowText: `version: 1
name: boundary fixture
project: {root: .}
start: work
steps:
  work:
    kind: agent
    harness: ${id}
    session: fresh
    prompt: report through wf
    outcomes: [complete]
    on: {complete: {goto: done}}
  done: {kind: end}
`,
          });
          service.coordinator.start(runId);
          await service.drive(runId);
          const state = service.coordinator.inspect(runId);
          assert.equal(
            state.transitions.at(-1)?.outcome,
            mode === "report" ? "complete" : "system.process_error",
          );
          assert.equal(inputs.length, 1);
          assert.equal(
            state.events.some((e) => e.type === "correction_requested"),
            false,
          );
          const event = state.events.find((e) => e.type === "invocation_settled");
          assert.ok(event);
          const diagnostics = event.data.diagnostics as {
            stderr: string;
            stderrTruncated: boolean;
            stdoutTruncated: boolean;
          };
          assert.match(diagnostics.stderr, /offline boundary diagnostic:/);
          assert.match(diagnostics.stderr, /credential submission rejected: 422/);
          assert.ok(Buffer.byteLength(diagnostics.stderr) <= 4096);
          assert.equal(diagnostics.stderrTruncated, true);
          if (id !== "opencode") assert.equal(diagnostics.stdoutTruncated, true);
          const token = inputs[0]?.reportAccess?.token;
          assert.ok(token);
          const evidence = JSON.stringify(state);
          assertScrubbed(evidence, [KEY, RETIRED, token]);
          const logs = readdirSync(path.join(root, "logs")).filter((f) => f.endsWith(".log"));
          assert.equal(logs.length, 1);
          const log = readFileSync(path.join(root, "logs", logs[0] ?? "missing.log"), "utf8");
          assert.match(log, /boundary_evidence/);
          assert.match(log, /\[redacted\]/);
          assert.doesNotMatch(log, /synthetic-|c3ludGhldGlj|b3BlbmNvZGU6/);
          assert.match(
            log,
            id === "opencode"
              ? mode === "crash"
                ? /"type":"error"/
                : /"type":"result"/
              : id === "claude"
                ? /"type":"system"/
                : id === "codex"
                  ? /"thread.started"/
                  : /"type":"session"/,
          );
          assertScrubbed(log, [KEY, RETIRED, token]);
          const recorded = JSON.parse(readFileSync(capture, "utf8"));
          const expectedNames = [
            "PATH",
            "HOME",
            configName,
            keyName,
            "WF_REPORT_ENDPOINT",
            "WF_REPORT_TOKEN",
            ...(id === "opencode" ? ["OPENCODE_PASSWORD"] : []),
          ];
          assert.deepEqual(Object.keys(recorded.env).sort(), expectedNames.sort());
          assert.equal(recorded.env[keyName], "[present]");
          for (const names of JSON.parse(readFileSync(config, "utf8")).probeEnvironments) {
            for (const name of [
              keyName,
              "WF_REPORT_TOKEN",
              "NODE_OPTIONS",
              "GITHUB_TOKEN",
              "UNRELATED_PARENT",
            ])
              assert.equal(names.includes(name), false);
          }
        } finally {
          database.close();
          rmSync(root, { recursive: true, force: true });
        }
      });
    }
  }

  it("OpenCode's nested server reselects its environment even when the bridge starts polluted", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wf-bridge-env-"));
    try {
      const capture = path.join(root, "capture.json");
      const config = path.join(root, "config.json");
      writeFileSync(config, JSON.stringify({ plan: [{ mode: "silent" }], options: {}, capture }));
      const result = await startProcess({
        command: process.execPath,
        args: [path.join(REPO_ROOT, "dist/adapters/opencode-bridge.js")],
        cwd: root,
        env: {
          PATH: process.env.PATH,
          HOME: root,
          OPENCODE_CONFIG_DIR: root,
          OPENAI_API_KEY: KEY,
          WF_REPORT_TOKEN: RETIRED,
          WF_REPORT_ENDPOINT: "http://127.0.0.1:1/internal/reports",
          UNEXPECTED_BRIDGE_VALUE: "withheld",
          OPENCODE_PASSWORD: "stale-private-password",
        },
        stdin: JSON.stringify({
          binary: process.execPath,
          args: [path.join(REPO_ROOT, "test/fixtures/fake-opencode.mjs"), config],
          password: "new-private-lease",
          prompt: "offline fixture",
        }),
      }).completed;
      assert.equal(result.exitCode, 0);
      const { env } = JSON.parse(readFileSync(capture, "utf8"));
      assert.deepEqual(
        Object.keys(env).sort(),
        [
          "PATH",
          "HOME",
          "OPENCODE_CONFIG_DIR",
          "OPENAI_API_KEY",
          "WF_REPORT_TOKEN",
          "WF_REPORT_ENDPOINT",
          "OPENCODE_PASSWORD",
        ].sort(),
      );
      assert.match(result.stdout, /"outcome":"succeeded"/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
