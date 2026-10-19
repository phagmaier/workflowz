/** Run-local edits never add fields to the reusable workflow YAML. */
import { z } from "zod";
import { IDENTIFIER_PATTERN } from "./identifiers.js";
import { transitionMap } from "./workflow-schema.js";

const identifier = z.string().regex(IDENTIFIER_PATTERN);
const nonblank = z.string().trim().min(1);

export const taskStepOverrideSchema = z.strictObject({
  model: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  /** Take this declared normal outcome without invoking the agent/command. */
  skip: z.strictObject({ outcome: identifier }).optional(),
  on: transitionMap.optional(),
});

export const taskOverridesSchema = z.preprocess(
  (input, ctx) => {
    // Zod records omit __proto__; strict configuration must reject it rather than drop it.
    if (
      input &&
      typeof input === "object" &&
      "steps" in input &&
      input.steps &&
      typeof input.steps === "object"
    ) {
      const maps: object[] = [input.steps];
      for (const value of Object.values(input.steps)) {
        if (
          value &&
          typeof value === "object" &&
          "on" in value &&
          value.on &&
          typeof value.on === "object"
        )
          maps.push(value.on);
      }
      if (maps.some((map) => Object.hasOwn(map, "__proto__"))) {
        ctx.addIssue({ code: "custom", message: "unsupported mapping key '__proto__'" });
      }
    }
    return input;
  },
  z.strictObject({ steps: z.record(identifier, taskStepOverrideSchema) }),
);
export type TaskOverrides = z.infer<typeof taskOverridesSchema>;

export const workflowRevisionSchema = z.strictObject({
  workflowText: z.string().min(1),
  cursorStepId: identifier.optional(),
  reason: nonblank,
});
export type WorkflowRevisionInput = z.infer<typeof workflowRevisionSchema>;

export const taskOverrideEditSchema = z.strictObject({
  overrides: taskOverridesSchema,
  reason: nonblank,
});
export type TaskOverrideEdit = z.infer<typeof taskOverrideEditSchema>;
