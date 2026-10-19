/** Versioned local control requests; report authority remains on its separate attempt channel. */
import path from "node:path";
import { z } from "zod";
import {
  externalCleanupSchema,
  recoveryDecisionSchema,
  recoveryRequestSchema,
} from "./recovery.js";
import { taskOverrideEditSchema, workflowRevisionSchema } from "./run-configuration.js";

const id = z.string().min(1).max(512);
const reason = z.string().trim().min(1).max(4096);
const run = { runId: id };
const control = { ...run, expectedEventId: z.number().int().positive() };
export const workflowInputSchema = z.strictObject({
  workflowText: z
    .string()
    .min(1)
    .max(1024 * 1024),
  workflowDir: z.string().refine(path.isAbsolute, "workflowDir must be absolute"),
});
const workflow = workflowInputSchema.shape;
export const overrideSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("jump"), stepId: id, reason }),
  z.strictObject({ action: z.literal("skip"), outcome: id, reason }),
  z.strictObject({ action: z.literal("mark-task-complete"), taskId: id, reason }),
]);
export const managementRequestSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("ping") }),
  z.strictObject({ op: z.literal("shutdown") }),
  z.strictObject({ op: z.literal("validate"), ...workflow }),
  z.strictObject({ op: z.literal("import"), ...workflow }),
  z.strictObject({ op: z.literal("workflows") }),
  z.strictObject({
    op: z.literal("preview"),
    ...workflow,
    includeCompleted: z.boolean().optional(),
  }),
  z.strictObject({
    op: z.literal("create"),
    ...workflow,
    includeCompleted: z.boolean().optional(),
  }),
  z.strictObject({
    op: z.literal("create-import"),
    revisionId: z.number().int().positive(),
    includeCompleted: z.boolean().optional(),
  }),
  z.strictObject({ op: z.literal("runs") }),
  z.strictObject({ op: z.literal("status"), ...run }),
  z.strictObject({ op: z.literal("tasks"), ...run }),
  z.strictObject({ op: z.literal("reports"), ...run }),
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
  z.strictObject({ op: z.literal("override"), ...control, edit: overrideSchema }),
  z.strictObject({ op: z.literal("revise"), ...control, edit: workflowRevisionSchema }),
  z.strictObject({
    op: z.literal("task-overrides"),
    ...control,
    taskId: id,
    edit: taskOverrideEditSchema,
  }),
  z.strictObject({ op: z.literal("recovery"), ...run }),
  z.strictObject({ op: z.literal("reconcile"), ...control }),
  z.strictObject({ op: z.literal("recovery-terminate"), ...run, request: recoveryRequestSchema }),
  z.strictObject({ op: z.literal("recovery-confirm"), ...run, request: externalCleanupSchema }),
  z.strictObject({ op: z.literal("recovery-decide"), ...run, request: recoveryDecisionSchema }),
]);
export type ManagementRequest = z.infer<typeof managementRequestSchema>;
export const daemonAccessSchema = z.strictObject({
  version: z.literal(1),
  port: z.number().int().min(1).max(65535),
  token: z.string().regex(/^[a-f0-9]{64}$/),
});
export type DaemonAccess = z.infer<typeof daemonAccessSchema>;
