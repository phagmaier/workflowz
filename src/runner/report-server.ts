/** Private, short-lived loopback channel. Tokens stay in memory and expire at invocation settlement. */
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { scrubSecrets } from "../adapters/secrets.js";
import { REPORT_BODY_LIMIT, ReportRejected } from "../contracts/report.js";
import type { RunCoordinator } from "../engine/run-coordinator.js";

export interface ReportAccess {
  readonly endpoint: string;
  readonly token: string;
  /** Known injected authorization, including retired tokens; memory-only, never child environment. */
  readonly secrets: readonly string[];
}

export class ReportServer {
  private readonly tokens = new Map<string, string>();
  // Retired values have no authority; retain only until channel close to prevent resume echoes.
  private secrets: string[] = [];
  private server: Server | undefined;
  private endpoint = "";

  constructor(private readonly coordinator: RunCoordinator) {}

  async listen(): Promise<void> {
    if (this.server) throw new Error("report server is already listening");
    const server = createServer((req, res) => {
      void this.receive(req, res);
    });
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("report server has no TCP address");
    this.endpoint = `http://127.0.0.1:${address.port}/internal/reports`;
  }

  issue(attemptId: string): ReportAccess {
    if (!this.server?.listening) throw new Error("report server is not listening");
    this.tokens.clear();
    const token = randomBytes(32).toString("hex");
    this.tokens.set(token, attemptId);
    this.secrets.push(token);
    return { endpoint: this.endpoint, token, secrets: this.secrets };
  }

  /** Register adapter-injected credentials before yielding to any report request handlers. */
  protect(access: ReportAccess, values: readonly string[]): void {
    if (!this.tokens.has(access.token)) return;
    for (const value of new Set(values))
      if (value && !this.secrets.includes(value)) this.secrets.push(value);
  }

  revoke(access: ReportAccess): void {
    this.tokens.delete(access.token);
  }

  expireAll(): void {
    this.tokens.clear();
  }

  async close(): Promise<void> {
    this.tokens.clear();
    this.secrets = [];
    const server = this.server;
    this.server = undefined;
    if (!server?.listening) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }

  private async receive(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const reply = (status: number, body: object) => {
      res.writeHead(status, { "content-type": "application/json", connection: "close" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "POST" || req.url !== "/internal/reports") {
      reply(404, { error: "unknown report route" });
      return;
    }
    const auth = req.headers.authorization;
    const attemptId = auth?.startsWith("Bearer ") ? this.tokens.get(auth.slice(7)) : undefined;
    if (!attemptId) {
      reply(410, { error: "report authorization is expired or invalid" });
      return;
    }
    if (req.headers.origin || req.headers["content-type"]?.split(";")[0] !== "application/json") {
      reply(422, { error: "report requires application/json without browser origin" });
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    req.setTimeout(5000, () => req.destroy());
    try {
      for await (const chunk of req) {
        const bytes = Buffer.from(chunk as Buffer);
        size += bytes.length;
        if (size > REPORT_BODY_LIMIT) {
          reply(413, { error: "report exceeds 128 KiB" });
          return;
        }
        chunks.push(bytes);
      }
      // A token can expire while a request body is still arriving.
      if (this.tokens.get(auth?.slice(7) ?? "") !== attemptId) {
        reply(410, { error: "report authorization expired before submission" });
        return;
      }
      const body = Buffer.concat(chunks).toString("utf8");
      let value: unknown;
      try {
        value = JSON.parse(body);
      } catch {
        reply(422, { error: "report must be valid JSON" });
        return;
      }
      const serialized = JSON.stringify(value);
      if (scrubSecrets(serialized, this.secrets) !== serialized) {
        reply(422, { error: "report must not contain injected authorization" });
        return;
      }
      const accepted = this.coordinator.acceptReport(attemptId, value);
      reply(201, { accepted: true, reportId: accepted.reportId });
    } catch (error) {
      if (!res.headersSent && !res.destroyed)
        reply(error instanceof ReportRejected ? error.status : 500, {
          error: error instanceof ReportRejected ? error.message : "report could not be stored",
        });
    }
  }
}
