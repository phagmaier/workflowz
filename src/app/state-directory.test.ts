import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { REPO_ROOT } from "../test-support/paths.js";
import { privateStateDirectory, readDaemonAccess, stateDirectory } from "./state-directory.js";

function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), "wf-state-audit-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    assert.equal(existsSync(root), false);
  });
  return root;
}

function cli(directory: string, args: string[]) {
  return spawnSync(path.join(REPO_ROOT, "bin/wf"), ["--state-dir", directory, ...args], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] },
    timeout: 10000,
  });
}

const ACCESS = { version: 1, port: 12345, token: "a".repeat(64) };

describe("private state directory and discovery boundaries", () => {
  it("rejects blank environment selection rather than falling through and uses the home fallback", () => {
    assert.throws(() => stateDirectory(undefined, { WF_STATE_DIR: " \t" }), /must not be blank/);
    assert.equal(stateDirectory(undefined, {}), path.join(homedir(), ".local/state/workflowz"));
    assert.equal(stateDirectory(undefined, { XDG_STATE_HOME: "" }), stateDirectory(undefined, {}));
  });

  it("creates a private directory and checks the canonical target of directory aliases", (t) => {
    const root = fixture(t);
    const directory = path.join(root, "state");
    assert.equal(privateStateDirectory(directory, true), directory);
    assert.equal(statSync(directory).uid, process.getuid?.());
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    const alias = path.join(root, "alias");
    symlinkSync(directory, alias);
    assert.equal(privateStateDirectory(alias), directory);
    chmodSync(directory, 0o750);
    assert.throws(() => privateStateDirectory(alias), /current user with mode 0700/);
    chmodSync(directory, 0o700);
    const file = path.join(root, "not-a-directory");
    writeFileSync(file, "", { mode: 0o600 });
    assert.throws(() => privateStateDirectory(file), /current user with mode 0700/);
  });

  it("rejects another owner's directory and discovery without changing filesystem ownership", (t) => {
    const root = fixture(t);
    writeFileSync(path.join(root, "daemon.json"), JSON.stringify(ACCESS), { mode: 0o600 });
    // Real stat metadata, different caller identity; no privileged chown or host changes.
    const owner = process as NodeJS.Process & { getuid: () => number };
    const uid = owner.getuid();
    const caller = t.mock.method(owner, "getuid", () => uid + 1);
    assert.throws(() => privateStateDirectory(root), /current user with mode 0700/);
    caller.mock.restore();
    // readDaemonAccess checks directory identity first, then the opened file identity.
    const identity = t.mock.method(owner, "getuid", () => uid + 1);
    identity.mock.mockImplementationOnce(() => uid);
    assert.throws(() => readDaemonAccess(root), /owner-only regular file/);
  });

  it("accepts exactly 4096 discovery bytes and rejects 4097, non-files and invalid authority", (t) => {
    const root = fixture(t);
    const discovery = path.join(root, "daemon.json");
    const body = JSON.stringify(ACCESS);
    writeFileSync(discovery, body.padEnd(4096), { mode: 0o600 });
    assert.deepEqual(readDaemonAccess(root), ACCESS);
    writeFileSync(discovery, body.padEnd(4097));
    assert.throws(() => readDaemonAccess(root), /owner-only regular file/);
    for (const invalid of [
      "{",
      JSON.stringify({ ...ACCESS, port: 0 }),
      JSON.stringify({ ...ACCESS, extra: true }),
    ]) {
      writeFileSync(discovery, invalid);
      assert.throws(() => readDaemonAccess(root));
    }
    rmSync(discovery);
    mkdirSync(discovery, { mode: 0o700 });
    assert.throws(() => readDaemonAccess(root), /owner-only regular file/);
  });

  it("reports unavailable discovery without auto-starting or creating state", (t) => {
    const root = fixture(t);
    const directory = path.join(root, "absent");
    for (const json of [false, true]) {
      const result = cli(directory, [...(json ? ["--json"] : []), "daemon", "status"]);
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /daemon unavailable or discovery is unsafe; run wf daemon start/);
      if (json) assert.match(JSON.parse(result.stderr).error, /same state directory/);
      assert.equal(existsSync(directory), false);
    }
  });

  it("reports blank and unsafe startup directories and malformed commands with distinct exit codes", (t) => {
    const root = fixture(t);
    const blank = cli(" \t", ["daemon", "start"]);
    assert.equal(blank.status, 1, blank.stderr);
    assert.match(blank.stderr, /state directory must not be blank/);
    chmodSync(root, 0o750);
    const unsafe = cli(root, ["daemon", "start"]);
    assert.equal(unsafe.status, 1, unsafe.stderr);
    assert.match(unsafe.stderr, /state directory must be owned by the current user with mode 0700/);
    assert.equal(existsSync(path.join(root, "state.sqlite")), false);
    const malformed = cli(root, ["run", "resume", "run-id"]);
    assert.equal(malformed.status, 2, malformed.stderr);
    assert.match(malformed.stderr, /missing --expected-event/);
    assert.equal(existsSync(path.join(root, "daemon.json")), false);
  });
});
