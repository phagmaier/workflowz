import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { loadAppAssets } from "./browser-transport.js";
import { startDaemon } from "./daemon.js";
import { readDaemonAccess } from "./state-directory.js";

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const JS = "text/javascript; charset=utf-8";

function directory(t: { after: (fn: () => void) => void }, list: unknown) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-app-assets-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "assets"));
  writeFileSync(path.join(root, "index.html"), "<!doctype html>");
  writeFileSync(path.join(root, "assets", "a.js"), "export {};");
  writeFileSync(path.join(root, "secret.txt"), "private");
  if (list !== undefined) writeFileSync(path.join(root, "asset-list.json"), JSON.stringify(list));
  return pathToFileURL(`${root}/`);
}

function get(port: number, route: string, host = `127.0.0.1:${port}`) {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>(
    (resolve, reject) => {
      // Raw HTTP keeps "..", encoded segments and Host exactly as written.
      const req = httpRequest(
        { host: "127.0.0.1", port, path: route, headers: { host } },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
        },
      );
      req.on("error", reject);
      req.end();
    },
  );
}

describe("built browser app assets", () => {
  it("loads only plain relative paths with allowed types from the build list", (t) => {
    const ok = loadAppAssets(
      directory(t, [
        { path: "index.html", type: "text/html; charset=utf-8" },
        { path: "assets/a.js", type: JS },
      ]),
    );
    assert.deepEqual([...ok.keys()], ["/ui/", "/ui/assets/a.js"]);
    assert.equal(ok.get("/ui/assets/a.js")?.type, JS);
    assert.equal(loadAppAssets(directory(t, undefined)).size, 0, "an unbuilt app serves nothing");
    for (const entry of [
      { path: "../secret.txt", type: JS },
      { path: "/etc/passwd", type: JS },
      { path: "assets/../secret.txt", type: JS },
      { path: "assets//a.js", type: JS },
      { path: ".hidden.js", type: JS },
      { path: "assets\\a.js", type: JS },
      { path: "asset-list.json", type: JS },
      { path: "secret.txt", type: "text/plain" },
      { path: "assets/a.js" },
      "assets/a.js",
    ])
      assert.throws(
        () => loadAppAssets(directory(t, [entry])),
        /browser asset/,
        JSON.stringify(entry),
      );
    assert.throws(
      () =>
        loadAppAssets(
          directory(t, [
            { path: "assets/a.js", type: JS },
            { path: "assets/a.js", type: JS },
          ]),
        ),
      /duplicate/,
    );
    assert.throws(() => loadAppAssets(directory(t, { path: "index.html" })), /array/);
  });

  it("serves the real build at /ui/ with exact types, the unchanged CSP and no traversal", async (t) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wf-app-serve-"));
    const owner = await startDaemon(path.join(root, "state"));
    t.after(async () => {
      await owner.close();
      rmSync(root, { recursive: true, force: true });
    });
    const { port } = readDaemonAccess(path.join(root, "state"));
    const listed = JSON.parse(
      readFileSync(new URL("../ui-app/asset-list.json", import.meta.url), "utf8"),
    ) as { path: string; type: string }[];
    assert.ok(listed.some((entry) => entry.path.endsWith(".js")));
    assert.ok(listed.some((entry) => entry.path.endsWith(".css")));

    const page = await get(port, "/ui/");
    assert.equal(page.status, 200);
    assert.equal(page.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(page.headers["content-security-policy"], CSP);
    assert.equal(page.headers["cache-control"], "no-store");
    assert.equal(page.headers["x-content-type-options"], "nosniff");
    // CSP forbids inline code and styles; the built page must not need them.
    assert.doesNotMatch(page.body, /<script(?![^>]*\bsrc=)[^>]*>/i);
    assert.doesNotMatch(page.body, /<style|\sstyle=|\son[a-z]+=|javascript:|data:/i);
    for (const entry of listed.filter((e) => e.path !== "index.html")) {
      const asset = await get(port, `/ui/${entry.path}`);
      assert.equal(asset.status, 200, entry.path);
      assert.equal(asset.headers["content-type"], entry.type, entry.path);
      assert.equal(asset.headers["content-security-policy"], CSP);
      assert.ok(page.body.includes(`/ui/${entry.path}`), `${entry.path} is referenced`);
    }
    for (const route of [
      "/ui/index.html",
      "/ui/asset-list.json",
      "/ui/assets/",
      "/ui/?v=1",
      "/ui/../web/shell.ts",
      "/ui/%2e%2e/web/shell.html",
      "/ui/assets/../index.html",
      "/ui/assets/%2Fetc%2Fpasswd",
      "/ui//etc/passwd",
      "/ui/../../app/daemon.js",
    ])
      assert.equal((await get(port, route)).status, 404, route);
    assert.equal((await get(port, "/ui/", "localhost:1")).status, 403, "exact Host");
    for (const route of ["/ui/app", "/ui/app/"]) {
      const redirect = await get(port, route);
      assert.equal(redirect.status, 308);
      assert.equal(redirect.headers.location, "/ui/");
      assert.equal(redirect.headers["content-security-policy"], CSP);
      assert.equal((await get(port, route, "localhost:1")).status, 403);
    }
    for (const route of [
      "/ui/shell.js",
      "/ui/shell.css",
      "/ui/editor.js",
      "/ui/dashboard.js",
      "/ui/intervention.js",
      "/ui/app/assets/a.js",
      "/ui/app/index.html",
      "/ui/app/?v=1",
      "/ui/app/%2e%2e/index.html",
    ])
      assert.equal((await get(port, route)).status, 404, route);
  });
});
