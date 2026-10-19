import { z } from "zod";

/** Linux boot + /proc start ticks distinguish a process from later reuse of the same numeric PID. */
export const processIdentitySchema = z
  .object({
    pid: z.number().int().min(2).max(2_147_483_647),
    pgid: z.number().int().min(2).max(2_147_483_647),
    sid: z.number().int().min(2).max(2_147_483_647),
    bootId: z.uuid(),
    startTicks: z
      .string()
      .max(20)
      .regex(/^[0-9]+$/),
  })
  .strict();

export type ProcessIdentity = z.infer<typeof processIdentitySchema>;
export type ProcessObservation = "alive" | "gone" | "mismatch" | "unknown";
