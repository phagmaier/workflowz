// Response shapes come from the daemon source; the browser imports types only, never runtime code.
export type { BrowserDraft, BrowserRunEdit } from "../../src/app/browser-service.ts";
export type { BrowserEvents, BrowserRunStatus } from "../../src/app/management-service.ts";
export type { BrowserRequest } from "../../src/contracts/browser.ts";
export type { RunStatus } from "../../src/contracts/run-state.ts";
export type { Action, ResolvedTransition } from "../../src/engine/model.ts";
export type {
  AttentionRow,
  EventRow,
  ReportRow,
  RunRow,
  TaskRow,
} from "../../src/store/run-store.ts";

/** `workflows` reply: one row per immutable saved revision. */
export interface SavedWorkflow {
  revisionId: number;
  name: string;
  sourceDir: string;
  sha256: string;
}
export type { Diagnostic } from "../../src/contracts/diagnostics.ts";
export type { TaskImportPreview } from "../../src/contracts/task-import.ts";
export type { WorkflowDocument, WorkflowStep } from "../../src/contracts/workflow-schema.ts";
export type { RuleSource } from "../../src/engine/model.ts";
