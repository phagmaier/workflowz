/** Recovery decisions acknowledge uncertainty; they never supply an execution outcome. */
import { z } from "zod";
import { IDENTIFIER_PATTERN } from "./identifiers.js";

const request = {
  expectedEventId: z.number().int().positive(),
  attemptId: z.string().min(1).nullable(),
  reason: z.string().trim().min(1).max(4096),
};

export const recoveryRequestSchema = z.strictObject(request);
export type RecoveryRequest = z.infer<typeof recoveryRequestSchema>;

export const externalCleanupSchema = z.strictObject({
  ...request,
  confirmedNoSurvivingOperation: z.literal(true),
});
export type ExternalCleanupConfirmation = z.infer<typeof externalCleanupSchema>;

export const recoveryDecisionSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...request, action: z.literal("retry") }),
  z.strictObject({ ...request, action: z.literal("continue") }),
  z.strictObject({
    ...request,
    action: z.literal("skip"),
    outcome: z.string().regex(IDENTIFIER_PATTERN),
  }),
  z.strictObject({
    ...request,
    action: z.literal("jump"),
    stepId: z.string().regex(IDENTIFIER_PATTERN),
  }),
  z.strictObject({ ...request, action: z.literal("end") }),
]);
export type RecoveryDecision = z.infer<typeof recoveryDecisionSchema>;
