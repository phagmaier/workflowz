/** Browser authority permits preparation, inspection and explicit paused-run controls only. */
import path from "node:path";
import { z } from "zod";
import { overrideSchema, workflowInputSchema } from "./management.js";
import { workflowRevisionSchema } from "./run-configuration.js";

const run = { runId: z.string().min(1).max(512) };
const control = { ...run, expectedEventId: z.number().int().positive() };
const reason = z.string().trim().min(1).max(4096);

export const browserSourceSchema = z.union([
  workflowInputSchema,
  z.strictObject({ revisionId: z.number().int().positive() }),
]);
const selection = {
  source: browserSourceSchema,
  projectRoot: z.string().max(4096).refine(path.isAbsolute, "project root must be absolute"),
  instructions: z.array(z.string().min(1).max(4096)).max(256),
  taskPath: z.string().min(1).max(4096).nullable(),
  includeCompleted: z.boolean(),
};
export const browserRequestSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("session") }),
  z.strictObject({ op: z.literal("logout") }),
  z.strictObject({ op: z.literal("workflows") }),
  z.strictObject({ op: z.literal("runs") }),
  z.strictObject({ op: z.literal("status"), ...run }),
  z.strictObject({ op: z.literal("reports"), ...run }),
  z.strictObject({
    op: z.literal("output"),
    ...run,
    attemptId: z.string().min(1).max(512),
  }),
  z.strictObject({
    op: z.literal("events"),
    ...run,
    after: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(1000),
  }),
  z.strictObject({ op: z.literal("start"), ...control }),
  z.strictObject({ op: z.literal("pause"), ...control }),
  z.strictObject({ op: z.literal("stop"), ...control, reason }),
  z.strictObject({ op: z.literal("resume"), ...control, reason }),
  z.strictObject({ op: z.literal("run-edit"), ...control }),
  z.strictObject({
    op: z.literal("revise"),
    ...control,
    edit: workflowRevisionSchema.extend({
      workflowText: workflowInputSchema.shape.workflowText,
      reason,
    }),
  }),
  z.strictObject({ op: z.literal("override"), ...control, edit: overrideSchema }),
  z.strictObject({ op: z.literal("load"), source: browserSourceSchema }),
  z.strictObject({
    op: z.literal("draft"),
    workflowDir: workflowInputSchema.shape.workflowDir,
    workflowText: z.string().max(1024 * 1024),
    // Serialization is read-only; the ordinary YAML parser remains the sole model validator.
    model: z.record(z.string(), z.unknown()).optional(),
    run: z.strictObject(control).optional(),
  }),
  z.strictObject({ op: z.literal("preview"), ...selection }),
  z.strictObject({ op: z.literal("save"), ...selection }),
  z.strictObject({ op: z.literal("create"), ...selection }),
]);
export const browserPairSchema = z.strictObject({ code: z.string().regex(/^[a-f0-9]{64}$/) });
export type BrowserRequest = z.infer<typeof browserRequestSchema>;
export type BrowserSource = z.infer<typeof browserSourceSchema>;
