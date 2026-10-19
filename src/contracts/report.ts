/** Version 1 report body. Identity and routing are exclusively engine-owned. */
import { z } from "zod";

export const REPORT_BODY_LIMIT = 128 * 1024;
export const REPORT_LIMITS = { summary: 4096, issue: 4096, handoff: 65536, data: 32768 } as const;
const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => Buffer.byteLength(v) <= max);
export const reportSchema = z.strictObject({
  outcome: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  summary: text(REPORT_LIMITS.summary).refine((v) => v.trim().length > 0),
  issue: text(REPORT_LIMITS.issue).nullable().optional(),
  handoff: text(REPORT_LIMITS.handoff).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type AgentReport = z.infer<typeof reportSchema>;

export class ReportRejected extends Error {
  constructor(
    readonly status: 409 | 410 | 422,
    message: string,
  ) {
    super(message);
  }
}

export function validateReport(value: unknown, allowed: readonly string[]): AgentReport {
  // Bound depth/node count before schema traversal/stringification, including programmatic callers.
  let nodes = 0;
  const json = (v: unknown, depth = 0): boolean => {
    if (++nodes > 4096 || depth > 16) return false;
    if (v === null || typeof v === "string" || typeof v === "boolean") return true;
    if (typeof v === "number") return Number.isFinite(v);
    if (Array.isArray(v)) return v.every((item) => json(item, depth + 1));
    return (
      typeof v === "object" &&
      Object.getPrototypeOf(v) === Object.prototype &&
      Object.values(v).every((item) => json(item, depth + 1))
    );
  };
  const fail = () =>
    new ReportRejected(
      422,
      `invalid report: require outcome and non-empty summary; optional issue, handoff, data; bounded JSON only. Allowed outcomes: ${allowed.join(", ")}`,
    );
  if (!json(value)) throw fail();
  const parsed = reportSchema.safeParse(value);
  if (!parsed.success) throw fail();
  const report = parsed.data;
  if (JSON.stringify(report.data) !== JSON.stringify((value as { data?: unknown }).data))
    throw fail();
  if (
    !allowed.includes(report.outcome) ||
    Buffer.byteLength(JSON.stringify(report)) > REPORT_BODY_LIMIT ||
    Buffer.byteLength(JSON.stringify(report.data ?? {})) > REPORT_LIMITS.data
  )
    throw fail();
  return report;
}
