import { SYSTEM_OUTCOMES } from "../../../src/contracts/identifiers.ts";
/**
 * Visual workflow editing. Every function is pure and returns a new document; the daemon's
 * `draft` operation serializes, validates and routes it. Nothing here decides what is valid.
 */
import type {
  Action,
  Diagnostic,
  ResolvedTransition,
  RuleSource,
  SavedWorkflow,
  WorkflowDocument,
  WorkflowStep,
} from "../types.ts";
import { formatCommand, parseCommand } from "./command-line.ts";
import { harnessLabel, humanize, outcomeLabel } from "./format.ts";

export type Doc = Omit<WorkflowDocument, "steps"> & { steps: Record<string, WorkflowStep> };
type RoutedStep = Exclude<WorkflowStep, { kind: "end" }>;
export type Rule = NonNullable<RoutedStep["on"]>[string];
export type StepKind = WorkflowStep["kind"];

export const KINDS: readonly StepKind[] = ["agent", "command", "task.next", "task.complete", "end"];
export const HARNESSES = ["codex", "claude", "opencode", "pi", "omp"] as const;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,63}$/;

export const KIND_HINT: Record<StepKind, string> = {
  agent: "A coding agent works on a prompt and reports one of the outcomes you list.",
  command:
    "Runs a program in the project folder. Exit code 0 is “complete”, anything else “failed”.",
  "task.next":
    "Takes the next unchecked task from the checklist imported when the run was created.",
  "task.complete":
    "Records the current task as done in Workflowz. The checklist file isn't edited.",
  end: "Ends the run successfully.",
};

export const OUTCOME_HELP: Record<string, string> = {
  complete: "finished successfully",
  failed: "exited with a non-zero code",
  task_ready: "a task was picked",
  exhausted: "no tasks are left",
};

export const clone = (doc: Doc): Doc => structuredClone(doc);

/** Normal results a step can finish with. Engine failures (`system.*`) are separate. */
export function outcomesOf(step: WorkflowStep): string[] {
  switch (step.kind) {
    case "agent":
      return [...step.outcomes];
    case "command":
      return ["complete", "failed"];
    case "task.next":
      return ["task_ready", "exhausted"];
    case "task.complete":
      return ["complete"];
    case "end":
      return [];
  }
}

/** All declared engine failures remain routable on any nonterminal step. */
export function failuresOf(step: WorkflowStep): string[] {
  return step.kind === "end" ? [] : [...SYSTEM_OUTCOMES];
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** One plain sentence describing what the step does. */
export function stepSummary(step: WorkflowStep): string {
  switch (step.kind) {
    case "agent": {
      const who = `${harnessLabel(step.harness)}${step.model ? ` (${step.model})` : ""}`;
      if (step.prompt_file !== undefined)
        return `${who} follows the prompt in ${step.prompt_file}.`;
      const text = (step.prompt ?? "").replace(/\s+/g, " ").trim();
      return text ? `${who}: “${clip(text, 110)}”` : `${who} — no prompt yet.`;
    }
    case "command":
      return step.argv.length && step.argv[0]
        ? `Runs ${clip(Array.isArray(step.argv) ? formatCommand(step.argv) : String(step.argv), 80)} in ${step.cwd ?? "the project folder"}.`
        : "Runs a command — not set yet.";
    case "task.next":
      return "Takes the next unchecked task from the checklist.";
    case "task.complete":
      return "Records the current task as done.";
    case "end":
      return step.label ? `Ends the run: “${step.label}”.` : "Ends the run.";
  }
}

/** Short secondary line for the step list. */
export function stepMeta(step: WorkflowStep): string {
  if (step.kind === "agent")
    return `${harnessLabel(step.harness)}${step.model ? ` · ${step.model.split("/").pop()}` : ""}`;
  if (step.kind === "command")
    return (
      (Array.isArray(step.argv) ? formatCommand(step.argv) : String(step.argv)) || "No command yet"
    );
  if (step.kind === "end") return step.label ? `Finish · ${step.label}` : "Finish";
  return step.kind === "task.next" ? "Next task" : "Task done";
}

export function endLabel(doc: Doc, id: string): string {
  const step = doc.steps[id];
  if (step?.kind !== "end") return humanize(id);
  return step.label ? `Finish — ${step.label}` : `Finish (${humanize(id)})`;
}

export function ruleToAction(rule: Rule): Action {
  if ("goto" in rule) return { kind: "goto", target: rule.goto };
  if ("retry" in rule)
    return {
      kind: "retry",
      maxAttempts: rule.retry.max_attempts,
      backoffSeconds: rule.retry.backoff_seconds ?? 0,
    };
  return { kind: "pause" };
}

/** "Go to Review", "Finish — All done", "Pause and wait for me", "Retry this step (…)". */
export function describeAction(doc: Doc, action: Action): string {
  if (action.kind === "goto") {
    const target = doc.steps[action.target];
    if (!target) return `Go to “${action.target}” (no such step)`;
    return target.kind === "end"
      ? endLabel(doc, action.target)
      : `Go to ${humanize(action.target)}`;
  }
  if (action.kind === "pause") return "Pause and wait for me";
  return `Retry this step (up to ${action.maxAttempts} runs${
    action.backoffSeconds ? `, ${action.backoffSeconds} s apart` : ""
  })`;
}

function policyScope(doc: Doc, index: number): string {
  const match = doc.policies?.[index]?.match;
  if (!match) return "";
  if ("all" in match) return "all steps";
  if ("tags" in match) return `steps tagged ${match.tags.join(", ")}`;
  return `steps ${match.step_ids.map(humanize).join(", ")}`;
}

/** Where an inherited rule comes from, in words. */
export function sourceLabel(doc: Doc, source: RuleSource): string {
  switch (source.level) {
    case "step":
      return "Set on this step";
    case "step_id_policy":
    case "tag_policy":
    case "all_policy":
      return `From shared rule ${source.policyIndex + 1} (${policyScope(doc, source.policyIndex)})`;
    case "defaults":
      return "From the workflow defaults";
    case "built_in_pause":
      return "Built in: technical failures pause";
  }
}

/** Whether a shared rule or default mentions this result, so "use the shared rule" can apply. */
export function hasSharedRule(doc: Doc, outcome: string): boolean {
  return (
    Object.hasOwn(doc.defaults?.on ?? {}, outcome) ||
    (doc.policies ?? []).some((policy) => Object.hasOwn(policy.on, outcome))
  );
}

export type DestKey = string; // "" | "inherit" | "goto:<id>" | "pause" | "retry" | "new" | "finish-new"

export function destKey(rule: Rule | undefined): DestKey {
  if (!rule) return "inherit";
  if ("goto" in rule) return `goto:${rule.goto}`;
  return "retry" in rule ? "retry" : "pause";
}

export interface DestOption {
  value: DestKey;
  label: string;
  group: "Continue" | "Finish" | "Other" | null;
}

/** Destination choices for one result of one step, in the order they are offered. */
export function destinationOptions(
  doc: Doc,
  stepId: string,
  inherited: string | null,
  failure = false,
): DestOption[] {
  const options: DestOption[] = [];
  if (inherited !== null) options.push({ value: "inherit", label: inherited, group: null });
  for (const [id, step] of Object.entries(doc.steps))
    if (step.kind !== "end")
      options.push({
        value: `goto:${id}`,
        label: `Go to ${humanize(id)}${id === stepId ? " (this step again)" : ""}`,
        group: "Continue",
      });
  const ends = Object.entries(doc.steps).filter(([, step]) => step.kind === "end");
  for (const [id] of ends)
    options.push({ value: `goto:${id}`, label: endLabel(doc, id), group: "Finish" });
  if (!ends.length) options.push({ value: "finish-new", label: "Finish", group: "Finish" });
  options.push({ value: "pause", label: "Pause and wait for me", group: "Other" });
  options.push({ value: "retry", label: "Retry this step", group: "Other" });
  if (!failure) options.push({ value: "new", label: "＋ New step…", group: "Other" });
  return options;
}

export interface OutcomeRow {
  outcome: string;
  /** The step's own rule, if it sets one. */
  own: Rule | undefined;
  /** The daemon's resolution, when the workflow compiled. */
  effective: ResolvedTransition | undefined;
  /** No rule anywhere: the compiler reported it, or nothing at all mentions this result. */
  missing: boolean;
}

interface Checked {
  transitions: Readonly<Record<string, readonly ResolvedTransition[]>>;
  diagnostics: readonly Diagnostic[];
}

function missingOutcomes(diagnostics: readonly Diagnostic[], stepId: string): Set<string> {
  const missing = new Set<string>();
  for (const d of diagnostics)
    if (d.code === "incomplete_transition" && d.path[1] === stepId) {
      const match = /outcome '([^']+)'/.exec(d.message);
      if (match?.[1]) missing.add(match[1]);
    }
  return missing;
}

/** "Result → what happens next" rows, for normal results or technical failures. */
export function outcomeRows(
  doc: Doc,
  checked: Checked | null,
  stepId: string,
  failures = false,
): OutcomeRow[] {
  const step = doc.steps[stepId];
  if (!step || step.kind === "end") return [];
  const missing = checked ? missingOutcomes(checked.diagnostics, stepId) : new Set<string>();
  const resolved = checked?.transitions[stepId] ?? [];
  return (failures ? failuresOf(step) : outcomesOf(step)).map((outcome) => {
    const own = Object.hasOwn(step.on ?? {}, outcome) ? step.on?.[outcome] : undefined;
    return {
      outcome,
      own,
      effective: resolved.find((t) => t.outcome === outcome),
      missing: !own && (missing.has(outcome) || (!failures && !hasSharedRule(doc, outcome))),
    };
  });
}

/** A plain sentence for each route, e.g. "complete → Go to Review". */
export function routeLines(doc: Doc, checked: Checked | null, stepId: string): string[] {
  return outcomeRows(doc, checked, stepId).map(({ outcome, own, effective, missing }) => {
    const action = own ? ruleToAction(own) : effective?.action;
    return `${outcome} → ${action ? describeAction(doc, action) : missing ? "not chosen yet" : "shared rule"}`;
  });
}

// ---------- edits ----------

function routed(doc: Doc, stepId: string): RoutedStep {
  const step = doc.steps[stepId];
  if (!step || step.kind === "end") throw new Error(`Step ${stepId} has no results`);
  return step;
}

export function setRule(doc: Doc, stepId: string, outcome: string, rule: Rule | null): Doc {
  const next = clone(doc);
  const step = routed(next, stepId);
  const on = { ...(step.on ?? {}) };
  if (rule) on[outcome] = rule;
  else delete on[outcome];
  if (Object.keys(on).length) step.on = on;
  else delete step.on;
  return next;
}

/** Lowercase snake_case ID from a display name, unique among the steps. */
export function stepIdFor(doc: Doc, name: string, fallback = "step", except?: string): string {
  let base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56);
  if (!base) base = fallback.replace(".", "_");
  if (!/^[a-z]/.test(base)) base = `step_${base}`.slice(0, 56);
  let id = base;
  for (let n = 2; id !== except && Object.hasOwn(doc.steps, id); n++) id = `${base}_${n}`;
  return id;
}

/** A new step with safe defaults. Results the user must decide are left unconnected on purpose. */
export function newStep(doc: Doc, kind: StepKind): WorkflowStep {
  switch (kind) {
    case "agent": {
      const peer = Object.values(doc.steps).findLast((s) => s.kind === "agent");
      return {
        kind: "agent",
        harness: peer?.kind === "agent" ? peer.harness : "codex",
        ...(peer?.kind === "agent" && peer.model ? { model: peer.model } : {}),
        session: "fresh",
        prompt: "",
        outcomes: ["complete", "blocked"],
        on: { blocked: { pause: true } },
      };
    }
    case "command":
      return { kind: "command", argv: [], on: { failed: { pause: true } } };
    case "task.next":
      return { kind: "task.next" };
    case "task.complete":
      return { kind: "task.complete" };
    case "end":
      return { kind: "end" };
  }
}

/** Inserts a step after `after` (or at the end). Returns the new document and step ID. */
export function addStep(
  doc: Doc,
  kind: StepKind,
  name: string,
  after: string | null,
): { doc: Doc; id: string } {
  const id = stepIdFor(doc, name, kind === "end" ? "done" : kind);
  const entries = Object.entries(clone(doc).steps);
  const index = after ? entries.findIndex(([key]) => key === after) : -1;
  entries.splice(index < 0 ? entries.length : index + 1, 0, [id, newStep(doc, kind)]);
  return { doc: { ...clone(doc), steps: Object.fromEntries(entries) }, id };
}

/** Removes a step. References to it stay, so the checks explain what now needs a destination. */
export function removeStep(doc: Doc, id: string): Doc {
  const next = clone(doc);
  delete next.steps[id];
  return next;
}

export function moveStep(doc: Doc, id: string, delta: -1 | 1): Doc {
  const entries = Object.entries(clone(doc).steps);
  const index = entries.findIndex(([key]) => key === id);
  const other = index + delta;
  const item = entries[index];
  const neighbour = entries[other];
  if (!item || !neighbour) return doc;
  entries[index] = neighbour;
  entries[other] = item;
  return { ...clone(doc), steps: Object.fromEntries(entries) };
}

const renameRules = (on: Record<string, Rule> | undefined, from: string, to: string) => {
  if (!on) return;
  for (const [key, rule] of Object.entries(on))
    if ("goto" in rule && rule.goto === from) on[key] = { goto: to };
};

/**
 * Gives a step a new name (and ID), updating the first step, destinations, shared-rule step
 * lists and report context. `{{reports.<id>…}}` text in prompts is left for the checks to flag.
 */
export function renameStep(
  doc: Doc,
  from: string,
  name: string,
): { doc: Doc; id: string } | string {
  const step = doc.steps[from];
  if (!step) return "That step no longer exists.";
  if (!name.trim()) return "Type a name for the step.";
  const id = stepIdFor(doc, name, "step", from);
  if (id === from) return { doc, id };
  const next = clone(doc);
  next.steps = Object.fromEntries(
    Object.entries(next.steps).map(([key, value]) => [key === from ? id : key, value]),
  );
  if (next.start === from) next.start = id;
  for (const value of Object.values(next.steps)) {
    if (value.kind === "end") continue;
    renameRules(value.on, from, id);
    if (value.kind === "agent" && value.context?.include_reports)
      value.context.include_reports = value.context.include_reports.map((r) =>
        r === from ? id : r,
      );
  }
  renameRules(next.defaults?.on, from, id);
  for (const policy of next.policies ?? []) {
    renameRules(policy.on, from, id);
    if ("step_ids" in policy.match)
      policy.match = { step_ids: policy.match.step_ids.map((s) => (s === from ? id : s)) };
  }
  return { doc: next, id };
}

/** Adds a result an agent may report. Returns an explanation instead when the name can't work. */
export function addOutcome(doc: Doc, stepId: string, raw: string): Doc | string {
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!name) return "Type an outcome name first, for example needs_info.";
  if (name.startsWith("system.")) return "Names starting with “system.” are reserved.";
  if (!IDENTIFIER.test(name))
    return "Use lowercase letters, digits and _ only, starting with a letter (up to 64).";
  const next = clone(doc);
  const step = next.steps[stepId];
  if (step?.kind !== "agent") return "Only agent steps choose their own outcomes.";
  if (step.outcomes.includes(name)) return `“${name}” is already an outcome of this step.`;
  step.outcomes = [...step.outcomes, name];
  return next;
}

export function removeOutcome(doc: Doc, stepId: string, outcome: string): Doc {
  const next = clone(doc);
  const step = next.steps[stepId];
  if (step?.kind !== "agent") return doc;
  step.outcomes = step.outcomes.filter((o) => o !== outcome);
  if (step.on) {
    delete step.on[outcome];
    if (!Object.keys(step.on).length) delete step.on;
  }
  return next;
}

export function replaceStep(doc: Doc, id: string, step: WorkflowStep): Doc {
  const next = clone(doc);
  next.steps[id] = step;
  return next;
}

// ---------- saved workflows ----------

export interface WorkflowGroup {
  name: string;
  latest: SavedWorkflow;
  older: SavedWorkflow[];
  runs: number;
}

/** Saved revisions grouped by workflow name; every save is an immutable revision. */
export function groupWorkflows(
  saved: readonly SavedWorkflow[],
  runsPerRevision: ReadonlyMap<number, number>,
): WorkflowGroup[] {
  const groups = new Map<string, SavedWorkflow[]>();
  for (const revision of saved)
    groups.set(revision.name, [...(groups.get(revision.name) ?? []), revision]);
  return [...groups]
    .map(([name, revisions]) => {
      const sorted = [...revisions].sort((a, b) => b.revisionId - a.revisionId);
      const [latest, ...older] = sorted as [SavedWorkflow, ...SavedWorkflow[]];
      return {
        name,
        latest,
        older,
        runs: sorted.reduce((sum, r) => sum + (runsPerRevision.get(r.revisionId) ?? 0), 0),
      };
    })
    .sort((a, b) => b.latest.revisionId - a.latest.revisionId);
}

// ---------- starting points ----------

export const EXAMPLES = [
  { id: "single", name: "Single agent step", text: "One prompt, one agent, then finish." },
  { id: "loop", name: "Task loop", text: "Work through a Markdown checklist one task at a time." },
  { id: "commands", name: "Commands only", text: "Run programs in order. No agents." },
] as const;
export type ExampleId = (typeof EXAMPLES)[number]["id"];

export function exampleDoc(
  example: ExampleId,
  name: string,
  projectRoot: string,
  taskPath = "todo.md",
): Doc {
  const base = { version: 1 as const, name, project: { root: projectRoot } };
  if (example === "commands")
    return {
      ...base,
      start: "run_tests",
      steps: {
        run_tests: {
          kind: "command",
          argv: ["npm", "test"],
          on: { complete: { goto: "done" }, failed: { pause: true } },
        },
        done: { kind: "end" },
      },
    };
  if (example === "loop")
    return {
      ...base,
      tasks: { source: { kind: "markdown_checklist", path: taskPath } },
      start: "pick_task",
      limits: { max_step_executions: 100 },
      steps: {
        pick_task: {
          kind: "task.next",
          on: { task_ready: { goto: "implement" }, exhausted: { goto: "done" } },
        },
        implement: {
          kind: "agent",
          harness: "codex",
          session: "fresh",
          prompt:
            "Implement this task:\n{{task.text}}\n\nReport complete when it is done, or blocked if you can't finish it.",
          outcomes: ["complete", "blocked"],
          on: { complete: { goto: "mark_done" }, blocked: { pause: true } },
        },
        mark_done: { kind: "task.complete", on: { complete: { goto: "pick_task" } } },
        done: { kind: "end", label: "All tasks done" },
      },
    };
  return {
    ...base,
    start: "work",
    steps: {
      work: {
        kind: "agent",
        harness: "codex",
        session: "fresh",
        prompt:
          "Describe the change you want here.\n\nReport complete when it is done, or blocked if you can't finish it.",
        outcomes: ["complete", "blocked"],
        on: { complete: { goto: "done" }, blocked: { pause: true } },
      },
      done: { kind: "end" },
    },
  };
}

// ---------- checks ----------

export type ProblemPlace = "steps" | "project" | "yaml" | "rules" | "name" | "start";
export interface Problem {
  severity: "error" | "warning";
  text: string;
  stepId: string | null;
  /** The step field or result the problem belongs to, for showing it in context. */
  field: string | null;
  outcome: string | null;
  place: ProblemPlace;
  code: string;
}

const FIELD_LABEL: Record<string, string> = {
  harness: "agent",
  model: "model",
  prompt: "prompt",
  prompt_file: "prompt file",
  argv: "command",
  cwd: "working folder",
  env: "environment",
  outcomes: "outcomes",
  instructions: "instruction files",
  context: "report context",
  timeout_seconds: "time limit",
  tags: "tags",
  session: "conversation",
  label: "finish label",
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Turns compiler diagnostics into sentences placed next to what they are about. */
export function problems(diagnostics: readonly Diagnostic[], doc: Doc | null): Problem[] {
  return diagnostics.map((d) => {
    const [head, second, third, fourth] = d.path;
    const base = { severity: d.severity, code: d.code, outcome: null, field: null };
    if (head === "steps" && typeof second === "string") {
      const name = humanize(second);
      const field = typeof third === "string" ? third : null;
      let outcome = field === "on" && typeof fourth === "string" ? fourth : null;
      let text = `${name}: ${d.message}`;
      if (d.code === "incomplete_transition") {
        outcome = /outcome '([^']+)'/.exec(d.message)?.[1] ?? null;
        text = `${name}: choose what happens after “${outcome}”.`;
      } else if (d.code === "unreachable_step")
        text = `${name}: nothing leads here, so it never runs. Choose it as a destination for another step's outcome.`;
      else if (d.code === "unbounded_cycle") {
        const loop = /steps (.+) form a loop/.exec(d.message)?.[1]?.split(", ").map(humanize);
        text = `${loop ? loop.join(", ") : name} can repeat forever: no step or time limit is set, so a run loops until you pause or stop it.`;
      } else if (d.code === "unknown_step" && field === "on")
        text = `${name}: “${outcome ? outcomeLabel(outcome) : "a result"}” goes to a step that doesn't exist (“${/'([^']+)' is not/.exec(d.message)?.[1] ?? "?"}”).`;
      else if (d.code === "unknown_step" && (field === "prompt" || field === "context"))
        text = `${name}: refers to a step that doesn't exist (${/'([^']+)'$/.exec(d.message)?.[1] ?? d.message}).`;
      else if (d.code === "unknown_harness")
        text = `${name}: “${doc?.steps[second]?.kind === "agent" ? (doc.steps[second] as { harness: string }).harness : "?"}” isn't an agent Workflowz knows. Choose one from the list.`;
      else if (d.code === "tasks_required")
        text = `${name}: uses ${/\{\{[^}]+\}\}/.exec(d.message)?.[0] ?? "a task value"}, but this workflow has no task checklist. Add one on the Project tab.`;
      else if (field === "prompt" && /must not be empty|is required/.test(d.message))
        text = `${name}: write a prompt.`;
      else if (field === "argv" && /at least the executable|must not be empty/.test(d.message))
        text = `${name}: enter the command to run.`;
      else if (field === "argv" && fourth === undefined && d.code === "invalid_field") {
        // Form keeps text it can't split as a string; the parser explains how to finish it.
        const argv = (doc?.steps[second] as { argv?: unknown } | undefined)?.argv;
        if (typeof argv === "string")
          text = `${name} · command: ${
            parseCommand(argv).error ??
            "write the command as a list of arguments, or retype it in the Command field."
          }`;
        else text = `${name} · command: ${d.message}`;
      } else if (field && FIELD_LABEL[field])
        text = `${name} · ${FIELD_LABEL[field]}: ${d.message}`;
      return { ...base, text, stepId: second, field, outcome, place: "steps" as const };
    }
    if (head === "project" || head === "tasks") {
      const what =
        head === "tasks"
          ? "Task checklist"
          : second === "root"
            ? "Project folder"
            : "Instruction file";
      const text =
        d.code === "missing_path"
          ? `${what} not found: ${/'([^']+)'/.exec(d.message)?.[1] ?? d.message}`
          : `${what}: ${d.message}`;
      return {
        ...base,
        text,
        stepId: null,
        field: String(head === "tasks" ? "tasks" : second),
        place: "project" as const,
      };
    }
    if (head === "start")
      return {
        ...base,
        text:
          d.code === "unknown_step"
            ? `The first step “${doc?.start ?? ""}” doesn't exist. Choose one under “Runs first”.`
            : `First step: ${d.message}`,
        stepId: null,
        place: "start" as const,
      };
    if (head === "name")
      return { ...base, text: `Workflow name: ${d.message}`, stepId: null, place: "name" as const };
    const where =
      head === "policies"
        ? `Shared rule ${Number(second) + 1}`
        : head === "defaults"
          ? "Workflow defaults"
          : head === "limits"
            ? "Limits"
            : null;
    return {
      ...base,
      text: where ? `${where}: ${d.message}` : capitalize(d.message),
      field:
        head === "limits"
          ? "limits-title"
          : head === "defaults"
            ? "defaults-title"
            : head === "policies"
              ? `policy-${second}-scope`
              : null,
      stepId: null,
      place: where ? ("rules" as const) : ("yaml" as const),
    };
  });
}
