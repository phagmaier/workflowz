/** Invocation-local API client. EOF releases the private server; common supervision owns its group. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { openCodeEnvironment } from "./opencode-environment.js";
import { OPENCODE_RECORD_LIMIT, openCodeSessionId } from "./opencode-events.js";
import { environmentSecrets, SecretFilter } from "./secrets.js";

const requestSchema = z.strictObject({
  binary: z.string(),
  args: z.array(z.string()),
  password: z.string(),
  secrets: z.array(z.string()).optional(),
  prompt: z.string(),
  prior: openCodeSessionId.optional(),
  model: z
    .object({ providerID: z.string(), id: z.string(), variant: z.string().optional() })
    .optional(),
});
const sessionSchema = z.object({
  data: z.object({
    id: openCodeSessionId,
    location: z.object({ directory: z.string() }),
    outcome: z.enum(["succeeded", "failed", "interrupted"]).optional(),
    time: z.object({ idle: z.number().finite().optional() }),
  }),
});
const admissionSchema = z.object({
  data: z.object({
    id: z.string(),
    sessionID: openCodeSessionId,
    type: z.literal("user"),
    time: z.object({ created: z.number().finite() }),
  }),
});
const errorSchema = z.object({ _tag: z.string(), sessionID: z.string().optional() });
class MissingSession extends Error {}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const input = requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  const server = spawn(
    input.binary,
    [...input.args, "serve", "--stdio", "--hostname", "127.0.0.1", "--port", "0"],
    {
      env: openCodeEnvironment(process.env, {
        ...(process.env.WF_REPORT_ENDPOINT === undefined
          ? {}
          : { WF_REPORT_ENDPOINT: process.env.WF_REPORT_ENDPOINT }),
        ...(process.env.WF_REPORT_TOKEN === undefined
          ? {}
          : { WF_REPORT_TOKEN: process.env.WF_REPORT_TOKEN }),
        OPENCODE_PASSWORD: input.password,
      }),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  // Descendants stay in this bridge's supervised process group, never detached.
  const closed = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    server.once("close", (code, signal) => resolve({ code, signal }));
  });
  server.stdin.on("error", () => {});
  // Filter before multiplexing server channels: interleaving partial stdout/stderr credentials
  // would otherwise hide complete matches from the outer supervisor's stderr filter.
  const secrets = [
    ...environmentSecrets(process.env),
    ...(input.secrets ?? []),
    input.password,
    Buffer.from(`opencode:${input.password}`).toString("base64"),
  ];
  const stdoutDiagnostics = diagnosticWriter();
  const stderrDiagnostics = diagnosticWriter();
  const stdoutFilter = new SecretFilter(secrets, (chunk) => stdoutDiagnostics.push(chunk));
  const stderrFilter = new SecretFilter(secrets, (chunk) => stderrDiagnostics.push(chunk));
  server.stderr.on("data", (chunk: Buffer) => stderrFilter.push(chunk));
  server.stderr.on("end", () => {
    stderrFilter.end();
    stderrDiagnostics.end();
  });
  server.stdout.on("end", () => {
    stdoutFilter.end();
    stdoutDiagnostics.end();
  });
  let ready = false;
  let pending = Buffer.alloc(0);
  const endpoint = new Promise<string>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      emit({ type: "error", kind: "spawn_error", code: error.code ?? "UNKNOWN" });
      reject(error);
    });
    server.once("exit", () => reject(new Error("OpenCode exited before readiness")));
    server.stdout.on("data", (chunk: Buffer) => {
      if (ready) {
        stdoutFilter.push(chunk);
        return;
      }
      if (pending.length + chunk.length > OPENCODE_RECORD_LIMIT) {
        reject(new Error("OpenCode readiness record exceeded limit"));
        return;
      }
      pending = Buffer.concat([pending, chunk]);
      const newline = pending.indexOf(10);
      if (newline < 0) return;
      try {
        const value = z
          .object({ url: z.string().url() })
          .parse(
            JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(pending.subarray(0, newline)),
            ),
          );
        const url = new URL(value.url);
        if (
          url.protocol !== "http:" ||
          url.hostname !== "127.0.0.1" ||
          !url.port ||
          url.username ||
          url.password ||
          url.pathname !== "/" ||
          url.search ||
          url.hash
        )
          throw new Error("OpenCode returned a non-loopback endpoint");
        ready = true;
        stdoutFilter.push(pending.subarray(newline + 1));
        pending = Buffer.alloc(0);
        resolve(url.origin);
      } catch (error) {
        reject(error);
      }
    });
  });
  let emittedSpawnError = false;
  server.once("error", () => {
    emittedSpawnError = true;
  });
  try {
    const base = await endpoint;
    const headers = {
      authorization: `Basic ${Buffer.from(`opencode:${input.password}`).toString("base64")}`,
      "content-type": "application/json",
      "x-opencode-directory": encodeURIComponent(process.cwd()),
    };
    const request = async (
      method: string,
      route: string,
      body?: unknown,
      empty = false,
    ): Promise<unknown> => {
      const response = await fetch(`${base}${route}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
      });
      const buffers: Uint8Array[] = [];
      let bytes = 0;
      if (response.body)
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > OPENCODE_RECORD_LIMIT)
            throw new Error("OpenCode API response exceeded limit");
          buffers.push(chunk);
        }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(buffers));
      const value: unknown = text ? JSON.parse(text) : undefined;
      if (!response.ok) {
        const error = errorSchema.safeParse(value);
        if (
          input.prior &&
          response.status === 404 &&
          error.success &&
          error.data._tag === "SessionNotFoundError" &&
          error.data.sessionID === input.prior
        )
          throw new MissingSession();
        throw new Error("OpenCode API request failed");
      }
      if (empty && (response.status !== 204 || value !== undefined))
        throw new Error("OpenCode did not acknowledge an empty API result");
      return value;
    };
    const permissions = [{ action: "*", resource: "*", effect: "allow" }];
    const initial = sessionSchema.parse(
      await request(
        input.prior ? "GET" : "POST",
        input.prior ? `/api/session/${input.prior}` : "/api/session",
        input.prior
          ? undefined
          : { location: { directory: process.cwd() }, permissions, model: input.model },
      ),
    ).data;
    const id = input.prior ?? initial.id;
    if (initial.id !== id || initial.location.directory !== process.cwd())
      throw new MissingSession();
    emit({ type: "session", sessionID: id });
    if (input.prior) {
      await request("PATCH", `/api/session/${id}`, { permissions }, true);
      if (input.model)
        await request("POST", `/api/session/${id}/model`, { model: input.model }, true);
    }
    const messageID = `msg_${randomUUID().replaceAll("-", "")}`;
    const admission = admissionSchema.parse(
      await request("POST", `/api/session/${id}/prompt`, {
        id: messageID,
        text: input.prompt,
        delivery: "steer",
      }),
    ).data;
    if (admission.id !== messageID || admission.sessionID !== id)
      throw new Error("OpenCode prompt identity mismatch");
    await request("POST", `/api/experimental/session/${id}/wait`, undefined, true);
    const final = sessionSchema.parse(await request("GET", `/api/session/${id}`)).data;
    if (final.id !== id || final.location.directory !== process.cwd()) throw new MissingSession();
    if (
      final.time.idle === undefined ||
      final.time.idle < admission.time.created ||
      (initial.time.idle !== undefined && final.time.idle <= initial.time.idle) ||
      final.outcome === undefined
    )
      throw new Error("OpenCode did not confirm this execution's terminal outcome");
    emit({ type: "result", sessionID: id, outcome: final.outcome });
  } catch (error) {
    if (!emittedSpawnError)
      emit({
        type: "error",
        kind: error instanceof MissingSession ? "resume_unavailable" : "protocol_error",
      });
  } finally {
    server.stdin.end();
    // A terminal API response is not process settlement. A stuck server remains subject to timeout/stop.
    const result = await closed;
    if (result.code !== 0 || result.signal) process.exitCode = 1;
  }
}
function emit(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

/** Keep short diagnostic lines readable when merging channels; long/unterminated lines stay bounded. */
function diagnosticWriter() {
  let pending: Buffer = Buffer.alloc(0);
  return {
    push(chunk: Buffer): void {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length) {
        const newline = pending.indexOf(10);
        let count = newline >= 0 && newline < 4096 ? newline + 1 : Math.min(4096, pending.length);
        if (newline < 0 && pending.length < 4096) break;
        const boundary = count;
        if (newline < 0 || newline >= 4096)
          while (
            count < pending.length &&
            ((pending[count] ?? 0) & 0xc0) === 0x80 &&
            boundary - count < 3
          )
            count--;
        process.stderr.write(pending.subarray(0, count));
        pending = pending.subarray(count);
      }
    },
    end(): void {
      if (pending.length) process.stderr.write(pending);
      pending = Buffer.alloc(0);
    },
  };
}

// This module is only executed as the adapter's private child, never imported by the engine.
void main().catch(() => {
  emit({ type: "error", kind: "protocol_error" });
  process.exitCode = 1;
});
