/** Browser API client. Credentials are HttpOnly cookies; nothing here is retried automatically. */
import type { BrowserRequest } from "./types.ts";

export type FailureKind =
  /** The daemon could not be reached or did not answer in time. */
  | "unreachable"
  /** The browser session is missing, expired or replaced by another pairing. */
  | "unauthorized"
  /** The run changed after the page last read it (expectedEventId mismatch). */
  | "stale"
  /** The daemon refused the request because of the run's state; nothing changed. */
  | "conflict"
  /** Any other daemon rejection. */
  | "rejected";

export class ApiError extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const READ_TIMEOUT = 15_000;
// Stop waits for the owned process to exit; start/resume probe the harness first.
const CONTROL_TIMEOUT = 120_000;

interface ErrorBody {
  error?: string;
  diagnostics?: { severity: string; code: string; message: string }[];
  issues?: { path: (string | number)[]; message: string }[];
}

async function send<T>(route: string, body: unknown, timeout: number): Promise<T> {
  let response: Response;
  try {
    response = await fetch(route, {
      method: "POST",
      headers: { "content-type": "application/json", "x-workflowz-ui": "1" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError("unreachable", "The daemon did not answer.");
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new ApiError(
      response.ok ? "unreachable" : "rejected",
      "The daemon sent an unreadable reply.",
      response.status,
    );
  }
  if (response.ok) return parsed as T;
  const error = (parsed ?? {}) as ErrorBody;
  const detail = [
    error.error ?? `HTTP ${response.status}`,
    ...(error.diagnostics ?? [])
      .filter((d) => d.severity === "error")
      .map((d) => `${d.code}: ${d.message}`),
    ...(error.issues ?? []).map((i) => `${i.path.join(".")}: ${i.message}`),
  ].join("\n");
  if (response.status === 401) throw new ApiError("unauthorized", detail, 401);
  if (response.status === 409)
    throw new ApiError(
      /stale control request/.test(detail) ? "stale" : "conflict",
      detail,
      response.status,
    );
  throw new ApiError("rejected", detail, response.status);
}

const MUTATIONS = new Set(["start", "pause", "stop", "resume", "override", "logout"]);

export function api<T>(request: BrowserRequest): Promise<T> {
  return send<T>("/ui/api", request, MUTATIONS.has(request.op) ? CONTROL_TIMEOUT : READ_TIMEOUT);
}

export function pair(code: string): Promise<{ paired: true }> {
  return send("/ui/pair", { code }, READ_TIMEOUT);
}

/** Plain-language result of a failed action, written for the place where the action was taken. */
export function describeFailure(error: unknown): string {
  if (!(error instanceof ApiError)) return "Something went wrong in this page. Nothing was sent.";
  switch (error.kind) {
    case "stale":
      return "Not applied. The run changed since this page last updated, so nothing changed. Check its current state, then choose again.";
    case "conflict":
      return `Not applied, so nothing changed. The daemon said: ${error.message}`;
    case "unauthorized":
      return "Not applied. This browser's session ended, so nothing changed. Pair again to continue.";
    case "unreachable":
      return "No answer from the daemon, so it is unknown whether this was applied. Check the run's history once the page reconnects before trying again.";
    case "rejected":
      return `Not applied. The daemon said: ${error.message}`;
  }
}

/** Wording for a failed read; reads change nothing and the page keeps retrying them. */
export function describeReadFailure(error: unknown): string {
  if (error instanceof ApiError && error.kind === "unreachable")
    return "Can't reach the daemon. Runs keep going there; this page tries again every few seconds.";
  if (error instanceof ApiError && error.kind === "unauthorized")
    return "This browser's session ended. Pair again to continue.";
  return `Couldn't load this: ${error instanceof Error ? error.message : "unknown error"}`;
}
