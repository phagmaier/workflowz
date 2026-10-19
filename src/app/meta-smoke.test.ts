import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  loadMetaCredential,
  MetaCredentialError,
  parseMetaSmokeSelection,
  runMetaSmoke,
} from "./meta-smoke.js";

function sourceFixture(content: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-meta-secret-"));
  const file = path.join(root, "secrets.zsh");
  writeFileSync(file, content, { mode: 0o600 });
  return { root, file, remove: () => rmSync(root, { recursive: true, force: true }) };
}

const selectionArgs = [
  "--harness",
  "omp",
  "--scenario",
  "report",
  "--timeout-seconds",
  "5",
  "--artifacts-dir",
  "/unused-meta-smoke-artifacts",
];

describe("approved named Meta credential loading", () => {
  it("reads one literal assignment without executing surrounding shell code or importing other keys", () => {
    const f = sourceFixture("");
    const marker = path.join(f.root, "must-not-exist");
    const unrelatedName = "WF_META_TEST_UNRELATED";
    const priorUnrelated = process.env[unrelatedName];
    const priorModel = process.env.MODEL_API_KEY;
    try {
      writeFileSync(
        f.file,
        `touch '${marker}'\nexport ${unrelatedName}=other-secret\n# MUSE_SPARK_API_KEY=ignored\nexport MUSE_SPARK_API_KEY='LLM_synthetic_credential' # private\n`,
      );
      assert.equal(loadMetaCredential(f.file), "LLM_synthetic_credential");
      assert.equal(existsSync(marker), false);
      assert.ok(process.env[unrelatedName] === priorUnrelated, "unrelated environment was changed");
      assert.ok(process.env.MODEL_API_KEY === priorModel, "parent model credential was changed");
    } finally {
      f.remove();
    }
  });

  it("accepts raw and quoted literals, preserving credential bytes and treating CRLF as line endings", () => {
    const f = sourceFixture("");
    try {
      writeFileSync(f.file, "MUSE_SPARK_API_KEY=LLM_raw_123\r\n");
      assert.equal(loadMetaCredential(f.file), "LLM_raw_123");
      writeFileSync(f.file, '  export MUSE_SPARK_API_KEY="LLM_quoted_456"  # comment\n');
      assert.equal(loadMetaCredential(f.file), "LLM_quoted_456");
      writeFileSync(f.file, "MUSE_SPARK_API_KEY='literal-$not-expanded'\n");
      assert.equal(loadMetaCredential(f.file), "literal-$not-expanded");
    } finally {
      f.remove();
    }
  });

  it("rejects missing, duplicate, empty and executable/expanded assignments without exposing their contents", () => {
    const f = sourceFixture("");
    const secret = "LLM_do-not-disclose";
    try {
      for (const content of [
        `OTHER_KEY=${secret}\n`,
        `MUSE_SPARK_API_KEY=${secret}\nMUSE_SPARK_API_KEY=second\n`,
        "MUSE_SPARK_API_KEY=''\n",
        `MUSE_SPARK_API_KEY="${secret}-$HOME"\n`,
        `MUSE_SPARK_API_KEY=$(printf ${secret})\n`,
        `MUSE_SPARK_API_KEY=${secret}; touch /not-executed\n`,
        `MUSE_SPARK_API_KEY="${secret}\\n"\n`,
        `MUSE_SPARK_API_KEY='${secret}\0'\n`,
      ]) {
        writeFileSync(f.file, content);
        assert.throws(
          () => loadMetaCredential(f.file),
          (error) => error instanceof MetaCredentialError && !error.message.includes(secret),
        );
      }
    } finally {
      f.remove();
    }
  });

  it("refuses readable-by-others, oversized, missing and non-file sources before using credentials", () => {
    const f = sourceFixture("MUSE_SPARK_API_KEY=LLM_private\n");
    try {
      chmodSync(f.file, 0o640);
      assert.throws(() => loadMetaCredential(f.file), MetaCredentialError);
      chmodSync(f.file, 0o600);
      writeFileSync(f.file, "#".repeat(1024 * 1024 + 1));
      assert.throws(() => loadMetaCredential(f.file), MetaCredentialError);
      assert.throws(() => loadMetaCredential(path.join(f.root, "absent")), MetaCredentialError);
      assert.throws(() => loadMetaCredential(f.root), MetaCredentialError);
    } finally {
      f.remove();
    }
  });
});

describe("Meta smoke admission before credential or artifact access", () => {
  it("refuses execution without --execute before trying to load the credential", async () => {
    const selection = parseMetaSmokeSelection(selectionArgs);
    await assert.rejects(
      runMetaSmoke(selection, { adapterOptions: { environment: { HOME: "/absent" } } }),
      /explicit --execute/,
    );
    assert.equal(existsSync(selection.artifactsDir), false);
  });

  it("rejects other providers/models/efforts and unrelated harnesses rather than silently changing them", async () => {
    for (const extra of [
      ["--model", "other"],
      ["--reasoning-effort", "high"],
    ])
      assert.throws(() => parseMetaSmokeSelection([...selectionArgs, ...extra]));
    assert.throws(() =>
      parseMetaSmokeSelection(selectionArgs.map((arg) => (arg === "omp" ? "codex" : arg))),
    );
    const selection = parseMetaSmokeSelection(selectionArgs);
    await assert.rejects(runMetaSmoke({ ...selection, execute: true, model: "other/model" }));
  });

  it("does not fall back to another environment key or create artifacts if the named credential is missing", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wf-meta-admission-"));
    try {
      mkdirSync(path.join(root, ".config"));
      const artifactsDir = path.join(root, "artifacts");
      await assert.rejects(
        runMetaSmoke(
          { ...parseMetaSmokeSelection(selectionArgs), execute: true, artifactsDir },
          { adapterOptions: { environment: { HOME: root, MODEL_API_KEY: "must-not-fallback" } } },
        ),
        MetaCredentialError,
      );
      assert.equal(existsSync(artifactsDir), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
