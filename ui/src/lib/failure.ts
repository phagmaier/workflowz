/** Presentation of technical results. Diagnostic text never changes routing or report authority. */
import { isSystemOutcome, outcomeLabel, sentence } from "./format.ts";
import type { StepItem } from "./history.ts";

// Only the bridge's fixed categories/codes may be promoted out of saved stderr. Arbitrary
// diagnostics remain in Output, including unknown codes and text around a recognized line.
const BRIDGE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "HPE_HEADER_OVERFLOW",
  "ERR_ENCODING_INVALID_ENCODED_DATA",
  "server_exited_before_readiness",
  "readiness_too_large",
  "invalid_loopback_endpoint",
  "response_too_large",
  "http_error",
  "invalid_empty_acknowledgment",
  "prompt_identity_mismatch",
  "terminal_outcome_unconfirmed",
  "resume_unavailable",
  "invalid_api_response",
  "protocol_error",
]);
const CONNECTION_CAUSES: Record<string, string> = {
  ECONNRESET: "The OpenCode bridge connection was reset (ECONNRESET).",
  ECONNREFUSED: "The OpenCode bridge connection was refused (ECONNREFUSED).",
  EPIPE: "The OpenCode bridge connection closed while sending data (EPIPE).",
};
const UNCONFIRMED = "the harness did not confirm successful execution";

export function technicalFailure(
  item: StepItem,
  harness?: string,
): { cause: string; detail: string | null } | null {
  if (!item.outcome || !isSystemOutcome(item.outcome)) return null;
  // Older immutable events retain their original wording in Technical details.
  const detail =
    item.failureDetail === "the agent provider failed" ? UNCONFIRMED : item.failureDetail;
  const label = outcomeLabel(item.outcome);
  let cause =
    detail === UNCONFIRMED
      ? "The harness did not confirm successful execution."
      : item.timedOut
        ? "The step exceeded its configured time limit."
        : item.exitCode !== null && item.exitCode !== 0
          ? `The process exited with status ${item.exitCode}.`
          : sentence(label.charAt(0).toUpperCase() + label.slice(1));
  const lines =
    harness === "opencode"
      ? (item.stderr?.matchAll(/^OpenCode bridge failed \(([A-Za-z_]+)\)\.\r?$/gm) ?? [])
      : [];
  for (const match of lines) {
    const code = match[1];
    if (code && BRIDGE_CODES.has(code)) {
      const diagnostic = CONNECTION_CAUSES[code] ?? `OpenCode bridge failed (${code}).`;
      cause = item.timedOut ? `${cause} ${diagnostic}` : diagnostic;
      break;
    }
  }
  return { cause, detail };
}
