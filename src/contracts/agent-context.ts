/** Explicit inputs assembled before launch; report authorization is never part of this snapshot. */
import type { AgentReport } from "./report.js";
export interface AgentContext {
  readonly task?:
    | {
        readonly id: string;
        readonly index: number;
        readonly title: string;
        readonly body: string;
        readonly headingPath: readonly string[];
      }
    | undefined;
  readonly instructions: readonly { readonly path: string; readonly content: string }[];
  readonly reports: Readonly<Record<string, AgentReport>>;
}
export interface AgentInputSnapshot {
  readonly harness?: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly cwd: string;
  readonly prompt: string;
  readonly context: AgentContext;
  readonly allowedOutcomes: readonly string[];
}
