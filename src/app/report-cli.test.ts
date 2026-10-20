import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { type ProcessResult, startProcess } from "../adapters/process.js";
import { REPO_ROOT } from "../test-support/paths.js";

const TOKEN = "synthetic-report-cli-boundary-token";
const HANDOFF = `${"é".repeat(32766)}tail`;

interface CapturedRequest {
  body: string;
}

async function fixture(
  response: { status: number; text: string },
  work: (f: {
    root: string;
    requests: CapturedRequest[];
    cli: (args: string[]) => Promise<ProcessResult>;
  }) => Promise<void>,
) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-report-cli-"));
  const requests: CapturedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      requests.push({
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(response.status, { "content-type": "application/json" });
      res.end(response.text);
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const endpoint = `http://127.0.0.1:${address.port}/internal/reports`;
    await work({ root, requests, cli: (args) => runCli(root, endpoint, args) });
  } finally {
    try {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

async function runCli(root: string, endpoint: string, args: string[]) {
  const child = startProcess({
    command: path.join(REPO_ROOT, "bin", "wf"),
    args: ["report", "complete", "--summary", "done", ...args],
    cwd: root,
    env: {
      PATH: process.env["PATH"],
      WF_REPORT_ENDPOINT: endpoint,
      WF_REPORT_TOKEN: TOKEN,
    },
    timeoutMs: 10000,
    graceMs: 100,
    // Observe the CLI's own redaction, not the supervisor's secret filter.
  });
  try {
    const result = await child.completed;
    assert.equal(result.spawnError, null);
    assert.equal(result.timedOut, false);
    assert.equal(result.signal, null);
    assert.equal(result.stdoutTruncated, false);
    assert.equal(result.stderrTruncated, false);
    return result;
  } finally {
    await child.terminate();
  }
}

describe("report CLI input and acknowledgment bounds", () => {
  it("transmits every byte of an exact 64 KiB UTF-8 handoff file", async () => {
    await fixture({ status: 201, text: "{}" }, async (f) => {
      assert.equal(Buffer.byteLength(HANDOFF), 65536);
      const handoff = path.join(f.root, "handoff.txt");
      writeFileSync(handoff, HANDOFF);
      const result = await f.cli(["--handoff-file", handoff]);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "report accepted\n");
      assert.equal(result.stderr, "");
      assert.equal(f.requests.length, 1);
      const request = f.requests[0];
      assert.ok(request);
      assert.deepEqual(JSON.parse(request.body), {
        outcome: "complete",
        summary: "done",
        handoff: HANDOFF,
      });
    });
  });

  it("rejects a handoff file one byte over 64 KiB without submitting a request", async () => {
    await fixture({ status: 201, text: "{}" }, async (f) => {
      const handoff = path.join(f.root, "handoff.txt");
      const content = `${HANDOFF}!`;
      assert.equal(Buffer.byteLength(content), 65537);
      writeFileSync(handoff, content);
      const result = await f.cli(["--handoff-file", handoff]);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /handoff file exceeds 64 KiB/);
      assert.equal(f.requests.length, 0);
    });
  });

  for (const status of [201, 422]) {
    it(`fails an oversized ${status} acknowledgment without echoing its body or token`, async () => {
      const marker = "untrusted-acknowledgment-body";
      const text = JSON.stringify({ error: `${marker}:${TOKEN}:${"x".repeat(8193)}` });
      await fixture({ status, text }, async (f) => {
        const result = await f.cli([]);
        assert.equal(f.requests.length, 1);
        assert.equal(result.exitCode, 1);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /endpoint unavailable|acknowledgment|aborted/);
        assert.ok(Buffer.byteLength(result.stderr) < 1024);
        assert.equal(result.stderr.includes(marker), false);
        assert.equal(result.stderr.includes(TOKEN), false);
      });
    });
  }
});
