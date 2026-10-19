import { request } from "node:http";
import { type ManagementRequest, managementRequestSchema } from "../contracts/management.js";
import { readDaemonAccess } from "./state-directory.js";

export class ManagementError extends Error {
  constructor(
    readonly body: { error: string; diagnostics?: unknown; issues?: unknown },
    readonly status: number,
  ) {
    super(body.error);
  }
}

export async function managementRequest(
  directory: string,
  input: ManagementRequest,
): Promise<unknown> {
  const body = JSON.stringify(managementRequestSchema.parse(input));
  let access: ReturnType<typeof readDaemonAccess>;
  try {
    access = readDaemonAccess(directory);
  } catch {
    throw new Error(
      "daemon unavailable or discovery is unsafe; run wf daemon start with the same state directory",
    );
  }
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: access.port,
        path: "/api/v1",
        method: "POST",
        headers: {
          authorization: `Bearer ${access.token}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        res.setEncoding("utf8");
        let text = "";
        res.on("data", (chunk: string) => {
          text += chunk;
          if (Buffer.byteLength(text) > 32 * 1024 * 1024)
            req.destroy(new Error("oversized management response; use paginated events"));
        });
        res.on("error", () =>
          reject(
            new Error("daemon response interrupted; inspect status before retrying a mutation"),
          ),
        );
        res.on("end", () => {
          try {
            const result: unknown = JSON.parse(text);
            if ((res.statusCode ?? 500) >= 400) {
              const failure = result as { error?: string; diagnostics?: unknown; issues?: unknown };
              reject(
                new ManagementError(
                  { ...failure, error: failure.error ?? "management request rejected" },
                  res.statusCode ?? 500,
                ),
              );
            } else resolve(result);
          } catch {
            reject(new Error("invalid daemon response"));
          }
        });
      },
    );
    // Capability probes/stop may take time. A lost acknowledgment never triggers an automatic retry.
    req.setTimeout(120_000, () => req.destroy());
    req.on("error", () =>
      reject(
        new Error(
          "daemon unavailable or request timed out; inspect status before retrying a mutation",
        ),
      ),
    );
    req.end(body);
  });
}
