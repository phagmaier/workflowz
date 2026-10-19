import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { describe, it } from "node:test";
import { REPO_ROOT } from "../test-support/paths.js";
import { ManagementError, managementRequest } from "./management-client.js";

describe("management response decoding", () => {
  for (const status of [200, 422]) {
    it(`preserves split UTF-8 characters in a ${status} response`, async (t) => {
      const directory = mkdtempSync(path.join(REPO_ROOT, ".tmp-management-client-"));
      const result = { error: "Résumé 漢字 😀", task: "Crème brûlée 🛠️" };
      const bytes = Buffer.from(JSON.stringify(result));
      const server = createServer((req, res) => {
        req.resume();
        res.writeHead(status, { "content-type": "application/json" });
        // Distinct HTTP chunks split every multibyte character, regardless of TCP coalescing.
        for (let i = 0; i < bytes.length; i++) res.write(bytes.subarray(i, i + 1));
        res.end();
      });
      t.after(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        rmSync(directory, { recursive: true, force: true });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      writeFileSync(
        path.join(directory, "daemon.json"),
        JSON.stringify({ version: 1, port: address.port, token: "a".repeat(64) }),
        { mode: 0o600 },
      );
      const response = managementRequest(directory, { op: "ping" });
      if (status === 200) assert.deepEqual(await response, result);
      else
        await assert.rejects(response, (error: unknown) => {
          assert.ok(error instanceof ManagementError);
          assert.equal(error.status, status);
          assert.equal(error.message, result.error);
          assert.deepEqual(error.body, result);
          return true;
        });
    });
  }
});
