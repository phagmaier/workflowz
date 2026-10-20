/** Browser authority deliberately excludes all execution and existing-run mutations. */
import path from "node:path";
import { z } from "zod";
import { workflowInputSchema } from "./management.js";

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
  z.strictObject({ op: z.literal("load"), source: browserSourceSchema }),
  z.strictObject({
    op: z.literal("draft"),
    workflowDir: workflowInputSchema.shape.workflowDir,
    workflowText: z.string().max(1024 * 1024),
    // Serialization is read-only; the ordinary YAML parser remains the sole model validator.
    model: z.record(z.string(), z.unknown()).optional(),
  }),
  z.strictObject({ op: z.literal("preview"), ...selection }),
  z.strictObject({ op: z.literal("save"), ...selection }),
  z.strictObject({ op: z.literal("create"), ...selection }),
]);
export const browserPairSchema = z.strictObject({ code: z.string().regex(/^[a-f0-9]{64}$/) });
export type BrowserRequest = z.infer<typeof browserRequestSchema>;
export type BrowserSource = z.infer<typeof browserSourceSchema>;
