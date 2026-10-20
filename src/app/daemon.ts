/** Explicit foreground owner. Restart reconciles; only an explicit start/resume can dispatch. */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { ZodError } from "zod";
import type { AgentAdapter } from "../adapters/agent-adapter.js";
import { scrubSecrets } from "../adapters/secrets.js";
import { managementRequestSchema } from "../contracts/management.js";
import { RunStateError, WorkflowInvalidError } from "../engine/run-coordinator.js";
import { WorkflowDatabase } from "../store/database.js";
import { BrowserTransport } from "./browser-transport.js";
import { HttpRequestError, readJsonBody } from "./http-body.js";
import { ManagementService } from "./management-service.js";
import { privateStateDirectory, readDaemonAccess } from "./state-directory.js";

export async function startDaemon(directory: string, agents?: Map<string, AgentAdapter>) {
  const dir = privateStateDirectory(directory, true);
  const oldMask = process.umask(0o077);
  let database: WorkflowDatabase;
  try {
    database = new WorkflowDatabase(path.join(dir, "state.sqlite"));
  } catch (error) {
    process.umask(oldMask);
    throw error;
  }
  const token = randomBytes(32).toString("hex");
  const discovery = path.join(dir, "daemon.json");
  const temporary = path.join(dir, `.daemon-${process.pid}.tmp`);
  let management: ManagementService;
  try {
    management = new ManagementService(database, path.join(dir, "logs"), agents);
  } catch (error) {
    database.close();
    process.umask(oldMask);
    throw error;
  }
  const browser = new BrowserTransport(management);
  let closing: Promise<void> | undefined;
  let finish: () => void = () => {};
  let fail: (error: unknown) => void = () => {};
  const closed = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const server = createServer((req, res) => {
    void receive(req, res);
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      await management.shutdown();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
      try {
        // Missing/changed discovery cannot keep the writer lease alive after shutdown.
        if (readDaemonAccess(dir).token === token) rmSync(discovery);
      } catch {
        /* never remove someone else's or an unsafe discovery file */
      } finally {
        database.close();
        process.umask(oldMask);
      }
    })();
    void closing.then(finish, fail);
    return closing;
  };
  const reply = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", connection: "close" });
    res.end(JSON.stringify(body));
  };
  async function receive(req: IncomingMessage, res: ServerResponse) {
    try {
      if (await browser.receive(req, res)) return;
      if (req.method !== "POST" || req.url !== "/api/v1") {
        reply(res, 404, { error: "unknown management route" });
        return;
      }
      const supplied = Buffer.from(req.headers.authorization ?? "");
      const expected = Buffer.from(`Bearer ${token}`);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        reply(res, 401, { error: "invalid management authorization" });
        return;
      }
      if (req.headers.origin || req.headers["content-type"]?.split(";")[0] !== "application/json") {
        reply(res, 422, { error: "management requires application/json without browser origin" });
        return;
      }
      const body = await readJsonBody(req);
      const request = managementRequestSchema.parse(body);
      if (request.op === "browser-access") {
        if (((await management.handle({ op: "ping" })) as { closing: boolean }).closing)
          throw new RunStateError("daemon is shutting down");
        reply(res, 200, browser.access(req.socket.localPort as number));
        return;
      }
      if (request.op === "shutdown") {
        management.requestShutdown();
        try {
          reply(res, 202, {
            accepted: true,
            message: "pausing after current step before shutdown",
          });
        } finally {
          // Give the acknowledgment a turn to flush, but never make admitted teardown depend
          // on response delivery: a reset client can prevent the response's finish event.
          setImmediate(() => {
            void close().catch(() => {});
          });
        }
        return;
      }
      reply(res, 200, await management.handle(request));
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      if (error instanceof HttpRequestError) {
        reply(res, error.status, { error: error.message });
        return;
      }
      if (error instanceof WorkflowInvalidError)
        reply(res, 422, { error: "invalid workflow definition", diagnostics: error.diagnostics });
      else if (error instanceof ZodError)
        reply(res, 422, {
          error: "invalid management request",
          issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
        });
      else
        reply(res, error instanceof RunStateError ? 409 : 400, {
          error: scrubSecrets(
            error instanceof Error ? error.message : "management operation failed",
            [token],
          ),
        });
    }
  }
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("daemon has no loopback address");
    writeFileSync(temporary, JSON.stringify({ version: 1, port: address.port, token }), {
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporary, discovery);
    return { management, close, closed, directory: dir };
  } catch (error) {
    server.close();
    rmSync(temporary, { force: true });
    database.close();
    process.umask(oldMask);
    throw error;
  }
}
