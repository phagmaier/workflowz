// Synthetic v2 private-server CLI. No provider; actual wf reporting and process trees remain real.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boundaryEvidence } from "./boundary-controls.mjs";
import { probeReply } from "./probe-controls.mjs";

const [configFile, ...args] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configFile, "utf8"));
if (args.includes("--version")) {
  probeReply(config, args, "opencode v2.0.32");
  await new Promise(() => {});
}
if (args.includes("--help")) {
  probeReply(
    config,
    args,
    args[0] === "serve"
      ? "--stdio --hostname --port"
      : args[0] === "session"
        ? config.options.supportsResume === false
          ? "list"
          : "list export"
        : "--model provider/model#variant --format json --session --auto",
  );
  await new Promise(() => {});
}
if (args.join(" ") !== "serve --stdio --hostname 127.0.0.1 --port 0")
  throw new Error("invalid private-server launch");
const index = config.index ?? 0;
config.index = index + 1;
writeFileSync(configFile, JSON.stringify(config));
const script = config.plan[index] ?? { mode: "report", outcome: "complete" };
const root = process.env.OPENCODE_CONFIG_DIR;
const requests = [];
let active;
let terminal = false;
let chosenID;
const file = (id) => path.join(root, `${id}.json`);
const capture = () => {
  if (config.capture)
    writeFileSync(
      config.capture,
      JSON.stringify({
        args,
        cwd: process.cwd(),
        requests,
        env: Object.fromEntries(
          Object.entries(process.env).map(([key, value]) => [
            key,
            /KEY|TOKEN|PASSWORD|SECRET/.test(key) ? "[present]" : value,
          ]),
        ),
      }),
    );
};
const server = createServer(async (req, res) => {
  try {
    if (
      req.headers.authorization !==
      `Basic ${Buffer.from(`opencode:${process.env.OPENCODE_PASSWORD}`).toString("base64")}`
    ) {
      res.writeHead(401).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    requests.push({ method: req.method, path: req.url, body });
    capture();
    const send = (value) => {
      if (!res.headersSent) res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(value));
    };
    const match = req.url.match(/^\/api\/(?:experimental\/)?session\/(ses_[\w-]+)(?:\/(\w+))?$/);
    if (req.method === "POST" && req.url === "/api/session") {
      chosenID = `ses_${randomUUID().replaceAll("-", "")}`;
      const info = {
        id: chosenID,
        location: body.location,
        permissions: body.permissions,
        model: body.model,
        time: {},
      };
      writeFileSync(file(chosenID), JSON.stringify(info));
      send({ data: config.options.missingSession ? { ...info, id: undefined } : info });
      return;
    }
    if (!match) {
      res.writeHead(404).end();
      return;
    }
    const [, id, operation] = match;
    if (
      !existsSync(file(id)) ||
      (index > 0 && config.options.resumeError) ||
      script.mode === "unavailable-then-hang"
    ) {
      res.writeHead(404);
      send({ _tag: "SessionNotFoundError", sessionID: id });
      return;
    }
    const info = JSON.parse(readFileSync(file(id), "utf8"));
    if (req.method === "GET" && !operation) {
      if (terminal && script.mode === "invalid-json") {
        res.end("malformed");
        return;
      }
      if (terminal && script.mode === "oversized") {
        res.end("x".repeat(1024 * 1024 + 1));
        return;
      }
      if (terminal && script.mode === "invalid-utf8") {
        res.end(Buffer.from([0xff]));
        return;
      }
      if (terminal && script.mode === "truncated") {
        const socket = res.socket;
        res.writeHead(200, { "content-length": "1000" });
        res.end('{"data":', () => socket.destroy());
        return;
      }
      send({
        data:
          terminal && script.mode === "different-session"
            ? { ...info, id: `ses_${randomUUID()}` }
            : info,
      });
      return;
    }
    if (req.method === "PATCH") {
      if (script.mode === "delete-before-admission") {
        res.writeHead(404);
        send({ _tag: "SessionNotFoundError", sessionID: id });
        return;
      }
      Object.assign(info, body);
      writeFileSync(file(id), JSON.stringify(info));
      res.writeHead(204).end();
      return;
    }
    if (operation === "model") {
      info.model = body.model;
      writeFileSync(file(id), JSON.stringify(info));
      res.writeHead(204).end();
      return;
    }
    if (operation === "prompt") {
      await boundaryEvidence(config);
      if (script.mode === "delete-at-admission") {
        res.writeHead(404);
        send({ _tag: "SessionNotFoundError", sessionID: id });
        return;
      }
      const created = Date.now();
      if (script.mode === "wrong-admission") {
        send({ data: { id: "msg_wrong", sessionID: id, type: "user", time: { created } } });
        return;
      }
      const mode =
        script.mode === "report-then-error"
          ? "report"
          : [
                "different-session",
                "terminal-then-hang",
                "invalid-json",
                "oversized",
                "invalid-utf8",
                "truncated",
                "stale-terminal",
                "missing-terminal",
                "leak-credentials",
                "wrong-wait-ack",
                "delayed-wait",
                "wait-reset",
                "wait-redirect",
              ].includes(script.mode)
            ? "silent"
            : script.mode;
      if (script.mode === "leak-credentials")
        for (const key of ["OPENAI_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENCODE_PASSWORD"]) {
          const v = process.env[key] ?? "";
          process.stderr.write(v.slice(0, 5));
          await new Promise((r) => setTimeout(r, 15));
          process.stderr.write(v.slice(5) + "\n");
        }
      active = new Promise((resolve) => {
        const child = spawn(
          process.execPath,
          [
            fileURLToPath(new URL("fake-agent.mjs", import.meta.url)),
            mode,
            script.outcome ?? "complete",
            script.extra ?? "",
          ],
          {
            env: {
              ...process.env,
              FAKE_SESSION: `${file(id)}.fake`,
              FAKE_RESUME: index > 0 ? "1" : "0",
              FAKE_CORRECTION:
                index > 0 && body.text.includes("Do not modify source files") ? "1" : "0",
              FAKE_PROMPT: body.text,
              ...(config.options.logFile ? { FAKE_AGENT_LOG: config.options.logFile } : {}),
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        child.stdout.pipe(process.stderr);
        child.stderr.pipe(process.stderr);
        child.on("close", (code) => {
          if (code !== 0) {
            process.exit(code ?? 1);
            return;
          }
          terminal = true;
          info.outcome = ["provider-error", "report-then-error"].includes(script.mode)
            ? "failed"
            : "succeeded";
          info.time.idle =
            script.mode === "stale-terminal"
              ? 0
              : Math.max(Date.now(), created + 1, (info.time.idle ?? 0) + 1);
          if (script.mode === "missing-terminal") delete info.outcome;
          writeFileSync(file(id), JSON.stringify(info));
          resolve();
        });
      });
      send({ data: { id: body.id, sessionID: id, type: "user", time: { created } } });
      return;
    }
    if (operation === "wait" && req.url.startsWith("/api/experimental/")) {
      await active;
      if (script.mode === "delayed-wait")
        await new Promise((resolve) => setTimeout(resolve, Number(script.extra)));
      if (script.mode === "wait-reset") {
        res.destroy();
        return;
      }
      if (script.mode === "wait-redirect") {
        res.writeHead(307, { location: `/api/session/${id}/prompt` }).end();
        return;
      }
      if (script.mode === "wrong-wait-ack") {
        send({ outcome: "succeeded" });
        return;
      }
      res.writeHead(204).end();
      return;
    }
    res.writeHead(404).end();
  } catch {
    res.writeHead(500).end();
  }
});
server.listen(0, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  const line = JSON.stringify({ url }) + "\r\n";
  if (script.mode === "bad-ready") console.log('{"url":"https://example.com"}');
  else {
    process.stdout.write(line.slice(0, 5));
    setTimeout(() => process.stdout.write(line.slice(5)), 10);
  }
});
process.stdin.resume();
process.stdin.on("end", () => {
  if (["terminal-then-hang", "unavailable-then-hang"].includes(script.mode)) return;
  server.close();
  server.closeAllConnections();
});
