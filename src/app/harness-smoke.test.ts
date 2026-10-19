import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setTimeout } from "node:timers/promises";
// Real subprocess supervision/timeout integration: poll fixture admission, not a guessed settle delay.
import { REPO_ROOT } from "../test-support/paths.js";
import type { SmokeSelection } from "./harness-smoke.js";
import {
  checkSmokeAuthentication,
  parseSmokeSelection,
  runHarnessSmoke,
  smokePlan,
} from "./harness-smoke.js";

const argumentsForSmoke = [
  "--harness",
  "codex",
  "--model",
  "openai/synthetic",
  "--scenario",
  "report",
  "--timeout-seconds",
  "5",
  "--artifacts-dir",
  "/unused-smoke-artifacts",
];

function fixture(id = "codex", plan = [{ mode: "smoke-helper" }], options = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-smoke-test-"));
  const config = path.join(root, "config.json");
  writeFileSync(config, JSON.stringify({ plan, options }));
  return {
    root,
    config,
    selection: {
      ...parseSmokeSelection(argumentsForSmoke),
      execute: true,
      harness: id,
      artifactsDir: root,
    } satisfies SmokeSelection,
    dependencies: {
      authentication: async () => "available" as const,
      adapterOptions: {
        binary: process.execPath,
        prefixArgs: [path.join(REPO_ROOT, `test/fixtures/fake-${id}.mjs`), config],
        environment: {
          PATH: process.env.PATH,
          HOME: root,
          CLAUDE_CONFIG_DIR: root,
          OPENCODE_CONFIG_DIR: root,
          PI_CODING_AGENT_DIR: root,
        },
      },
    },
    remove() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("opt-in harness smoke admission", () => {
  it("plans without probes or filesystem writes and refuses runtime execution without admission", async () => {
    const selected = parseSmokeSelection(argumentsForSmoke);
    assert.equal(smokePlan(selected).maximumInvocations, 1);
    await assert.rejects(runHarnessSmoke(selected), /explicit --execute/);
    assert.equal(existsSync(selected.artifactsDir), false);
  });
  it("rejects missing, unknown, repeated, ambiguous and unbounded options", () => {
    for (const args of [
      [],
      [...argumentsForSmoke, "--harness", "pi"],
      [...argumentsForSmoke, "--all"],
      [...argumentsForSmoke, "--execute", "--execute"],
      argumentsForSmoke.map((arg) => (arg === "codex" ? "unknown" : arg)),
      argumentsForSmoke.map((arg) => (arg === "report" ? "both" : arg)),
      argumentsForSmoke.map((arg) => (arg === "5" ? "301" : arg)),
      argumentsForSmoke.map((arg) => (arg === "5" ? "0" : arg)),
      argumentsForSmoke.map((arg) => (arg === "openai/synthetic" ? "" : arg)),
      argumentsForSmoke.map((arg) => (arg === "/unused-smoke-artifacts" ? "." : arg)),
    ])
      assert.throws(() => parseSmokeSelection(args));
  });
});

describe("credential-free status checks", () => {
  for (const harness of ["codex", "pi", "claude"]) {
    it(`${harness} retains only documented status, never status payloads`, async () => {
      const f = fixture();
      try {
        for (const [code, expected] of [
          [0, "available"],
          [1, "unavailable"],
          [2, "status_failed"],
        ] as const) {
          const result = await checkSmokeAuthentication({ ...f.selection, harness }, f.root, {
            binary: process.execPath,
            prefixArgs: [
              path.join(REPO_ROOT, "test/fixtures/fake-smoke-auth.mjs"),
              harness,
              String(code),
            ],
            environment: { PATH: process.env.PATH, HOME: f.root, UNSELECTED_SECRET: "withheld" },
          });
          assert.equal(result, expected);
        }
      } finally {
        f.remove();
      }
    });
  }
  it("does not invent authentication evidence for an unsupported status command", async () => {
    const selected = parseSmokeSelection(argumentsForSmoke);
    assert.equal(
      await checkSmokeAuthentication({ ...selected, harness: "omp" }, "/absent"),
      "status_unsupported",
    );
    assert.equal(
      await checkSmokeAuthentication({ ...selected, harness: "opencode" }, "/absent"),
      "status_unsupported",
    );
  });
});

describe("offline smoke through installed-factory contracts and real wf", () => {
  for (const id of ["codex", "pi", "claude", "opencode", "omp"]) {
    for (const scenario of ["report", "correction"] as const) {
      it(`${id} ${scenario}: acknowledgment, settlement, exact session, reopen and target cleanup`, async () => {
        const f = fixture(
          id,
          scenario === "report"
            ? [{ mode: "smoke-helper" }]
            : [{ mode: "silent" }, { mode: "smoke-helper" }],
        );
        try {
          const result = await runHarnessSmoke({ ...f.selection, scenario }, f.dependencies);
          assert.equal(result.category, "passed", JSON.stringify(result));
          assert.equal(result.acknowledgment, true);
          assert.equal(result.durableReopen, true);
          assert.equal(result.invocationCount, scenario === "report" ? 1 : 2);
          assert.equal(result.correctionCount, scenario === "report" ? 0 : 1);
          if (scenario === "correction")
            assert.equal(result.sessionFingerprints?.[0], result.sessionFingerprints?.[1]);
          assert.equal(result.projectRemoved, true);
          assert.equal(existsSync(path.join(result.artifactRoot, "project")), false);
          assert.equal(existsSync(path.join(result.artifactRoot, "state.sqlite")), true);
          const evidence = JSON.parse(
            readFileSync(path.join(result.artifactRoot, "evidence.json"), "utf8"),
          );
          assert.deepEqual(evidence, result);
          assert.equal("reportAccess" in evidence, false);
          assert.equal("secrets" in evidence, false);
        } finally {
          f.remove();
        }
      });
    }
  }
  for (const [mode, category] of [
    ["provider-error", "provider_failure"],
    ["crash", "execution_failure"],
    ["silent", "execution_failure"],
    ["report", "smoke_assertion_failure"],
  ] as const) {
    it(`distinguishes ${mode} without hidden correction in report-only mode`, async () => {
      const f = fixture("codex", [{ mode }]);
      try {
        const result = await runHarnessSmoke(f.selection, f.dependencies);
        assert.equal(result.category, category);
        assert.equal(result.invocationCount, 1);
        assert.equal(result.correctionCount, 0);
        assert.equal(result.projectRemoved, true);
      } finally {
        f.remove();
      }
    });
  }
  for (const mode of ["silent", "provider-error", "crash"] as const) {
    it(`retains failed correction evidence for ${mode} without a third invocation`, async () => {
      const f = fixture("codex", [{ mode: "silent" }, { mode }]);
      try {
        const result = await runHarnessSmoke(
          { ...f.selection, scenario: "correction" },
          f.dependencies,
        );
        assert.equal(
          result.category,
          mode === "provider-error" ? "provider_failure" : "execution_failure",
        );
        assert.equal(result.outcome, "system.report_error");
        assert.equal(result.invocationCount, 2);
        assert.equal(result.correctionCount, 1);
        assert.equal(result.projectRemoved, true);
      } finally {
        f.remove();
      }
    });
  }
  it("does not treat an accidentally successful original as correction verification", async () => {
    const f = fixture();
    try {
      const result = await runHarnessSmoke(
        { ...f.selection, scenario: "correction" },
        f.dependencies,
      );
      assert.equal(result.outcome, "complete");
      assert.equal(result.category, "smoke_assertion_failure");
      assert.equal(result.correctionCount, 0);
    } finally {
      f.remove();
    }
  });
  it("bounds a hanging invocation and confirms cleanup", async () => {
    const f = fixture("codex", [{ mode: "hang" }]);
    try {
      const result = await runHarnessSmoke({ ...f.selection, timeoutSeconds: 1 }, f.dependencies);
      assert.equal(result.category, "execution_failure");
      assert.equal(result.outcome, "system.timeout");
      assert.equal(result.projectRemoved, true);
    } finally {
      f.remove();
    }
  });
  it("stops a live synthetic process through RunService on interruption", async () => {
    const f = fixture("codex", [{ mode: "hang" }]);
    const controller = new AbortController();
    try {
      const work = runHarnessSmoke(f.selection, { ...f.dependencies, signal: controller.signal });
      const deadline = Date.now() + 5000;
      while (!JSON.parse(readFileSync(f.config, "utf8")).index) {
        assert.ok(Date.now() < deadline);
        await setTimeout(10);
      }
      controller.abort();
      const result = await work;
      assert.equal(result.category, "execution_failure");
      assert.equal(result.outcome, "stopped");
      assert.equal(result.projectRemoved, true);
    } finally {
      f.remove();
    }
  });
  it("fails closed on unavailable correction before provider execution", async () => {
    const f = fixture("codex", [], { supportsResume: false });
    try {
      const result = await runHarnessSmoke(
        { ...f.selection, scenario: "correction" },
        f.dependencies,
      );
      assert.equal(result.category, "unsupported_capability");
      assert.equal(JSON.parse(readFileSync(f.config, "utf8")).index, undefined);
      assert.equal(result.projectRemoved, true);
    } finally {
      f.remove();
    }
  });
  for (const authentication of ["unavailable", "status_failed", "cleanup_uncertain"] as const) {
    it(`never launches on authentication ${authentication} and preserves uncertain artifacts`, async () => {
      const f = fixture();
      try {
        const result = await runHarnessSmoke(f.selection, {
          ...f.dependencies,
          authentication: async () => authentication,
        });
        assert.equal(
          result.category,
          authentication === "unavailable"
            ? "authentication_unavailable"
            : authentication === "status_failed"
              ? "authentication_check_failed"
              : "cleanup_uncertain",
        );
        assert.equal(JSON.parse(readFileSync(f.config, "utf8")).index, undefined);
        assert.equal(
          existsSync(path.join(result.artifactRoot, "project")),
          authentication === "cleanup_uncertain",
        );
      } finally {
        f.remove();
      }
    });
  }
});
