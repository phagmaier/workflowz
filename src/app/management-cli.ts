/** Thin management client. Agent report dispatch remains in bin/wf and report-cli. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { ZodError } from "zod";
import { type Diagnostic, formatDiagnostic } from "../contracts/diagnostics.js";
import { type ManagementRequest, managementRequestSchema } from "../contracts/management.js";
import { startDaemon } from "./daemon.js";
import { ManagementError, managementRequest } from "./management-client.js";
import { stateDirectory } from "./state-directory.js";
import { validateWorkflow } from "./workflow-validation.js";

const HELP = `usage: wf [--state-dir DIR] [--json] <command>
  daemon start|status|stop                  start runs in the foreground
  workflow validate|import FILE             validate or save an immutable revision
  workflow list
  tasks preview FILE [--include-completed]
  run create FILE [--include-completed]     create a ready run
  run create --revision ID
  run list|status ID|tasks ID|reports ID
  run events ID [--after ID] [--limit N]     exclusive event cursor; default 100
  run start|pause ID --expected-event ID
  run stop|resume ID --expected-event ID --reason TEXT
  run override ID --expected-event ID --request EDIT.json
  run revise ID --expected-event ID --file FILE --reason TEXT [--cursor STEP]
  run task-overrides ID --task TASK --expected-event ID --request EDIT.json
  run recovery ID
  run reconcile ID --expected-event ID
  run recovery-terminate|recovery-confirm|recovery-decide ID --request REQUEST.json
  report OUTCOME --summary TEXT [...]       attempt-scoped reporting
Inspect status for expectedEventId. Controls reject stale requests; never blindly retry.
Override edits: {action: jump, stepId, reason}, {action: skip, outcome, reason},
or {action: mark-task-complete, taskId, reason}. JSON files use quoted JSON keys/values.`;

class UsageError extends Error {}
class InputError extends Error {}

export async function managementMain(argv = process.argv.slice(2)): Promise<void> {
  let json = argv.includes("--json");
  let diagnosticFile = "workflow";
  try {
    const positional: string[] = [];
    const options = new Map<string, string | true>();
    const switches = new Set(["--json", "--include-completed", "--help"]);
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i] ?? "";
      if (!arg.startsWith("--")) {
        positional.push(arg);
        continue;
      }
      if (options.has(arg)) throw new UsageError(`duplicate option ${arg}`);
      if (switches.has(arg)) options.set(arg, true);
      else {
        const value = argv[++i];
        if (value === undefined || value.startsWith("--"))
          throw new UsageError(`missing value for ${arg}`);
        options.set(arg, value);
      }
    }
    json = options.delete("--json");
    const directoryOption = options.get("--state-dir");
    options.delete("--state-dir");
    const directory = stateDirectory(
      typeof directoryOption === "string" ? directoryOption : undefined,
    );
    const help = options.delete("--help");
    if (!help && positional.length === 0 && options.size)
      throw new UsageError(`unknown option ${options.keys().next().value}`);
    if (help || positional.length === 0) {
      console.log(HELP);
      return;
    }
    const [group, action, target] = positional;
    if (positional.length > 3) throw new UsageError("too many arguments");
    const option = (name: string, required = true): string | undefined => {
      const value = options.get(name);
      options.delete(name);
      if (typeof value === "string") return value;
      if (required) throw new UsageError(`missing ${name}`);
      return undefined;
    };
    const needTarget = () => {
      if (!target) throw new UsageError("missing run ID or workflow file");
      return target;
    };
    const includeCompleted = () => options.delete("--include-completed");
    const fileText = (file: string) => {
      try {
        return readFileSync(file, "utf8");
      } catch (error) {
        throw new InputError(
          `cannot read ${file}: ${(error as NodeJS.ErrnoException).code ?? "read failed"}`,
        );
      }
    };
    const workflow = (file: string) => {
      diagnosticFile = file;
      return { workflowText: fileText(file), workflowDir: path.dirname(path.resolve(file)) };
    };
    const requestFile = (): unknown => {
      const file = option("--request") as string;
      try {
        return JSON.parse(fileText(file));
      } catch (error) {
        if (error instanceof InputError) throw error;
        throw new UsageError("--request must contain valid JSON");
      }
    };
    const control = () => ({
      runId: needTarget(),
      expectedEventId: Number(option("--expected-event")),
    });
    let input: unknown;
    let localValidation: ReturnType<typeof validateWorkflow> | undefined;
    let daemon = false;
    if (group === "daemon") {
      if (target) throw new UsageError("daemon commands take no positional argument");
      if (action === "start") daemon = true;
      else if (action === "status") input = { op: "ping" };
      else if (action === "stop") input = { op: "shutdown" };
      else throw new UsageError("unknown daemon command");
    } else if (group === "workflow") {
      if (action === "validate") localValidation = validateWorkflow(workflow(needTarget()));
      else if (action === "import") input = { op: "import", ...workflow(needTarget()) };
      else if (action === "list" && !target) input = { op: "workflows" };
      else throw new UsageError("unknown workflow command");
    } else if (group === "tasks" && action === "preview")
      input = { op: "preview", ...workflow(needTarget()), includeCompleted: includeCompleted() };
    else if (group === "run") {
      switch (action) {
        case "create": {
          const revision = option("--revision", false);
          if (revision && target) throw new UsageError("choose a workflow file or --revision");
          input = revision
            ? {
                op: "create-import",
                revisionId: Number(revision),
                includeCompleted: includeCompleted(),
              }
            : { op: "create", ...workflow(needTarget()), includeCompleted: includeCompleted() };
          break;
        }
        case "list":
          if (target) throw new UsageError("run list takes no ID");
          input = { op: "runs" };
          break;
        case "status":
        case "tasks":
        case "reports":
        case "recovery":
          input = { op: action, runId: needTarget() };
          break;
        case "events":
          input = {
            op: "events",
            runId: needTarget(),
            after: Number(option("--after", false) ?? 0),
            limit: Number(option("--limit", false) ?? 100),
          };
          break;
        case "start":
        case "pause":
        case "reconcile":
          input = { op: action, ...control() };
          break;
        case "stop":
        case "resume":
          input = { op: action, ...control(), reason: option("--reason") };
          break;
        case "override":
          input = { op: action, ...control(), edit: requestFile() };
          break;
        case "task-overrides":
          input = { op: action, ...control(), taskId: option("--task"), edit: requestFile() };
          break;
        case "revise": {
          const file = option("--file") as string;
          diagnosticFile = file;
          const cursorStepId = option("--cursor", false);
          input = {
            op: action,
            ...control(),
            edit: {
              workflowText: fileText(file),
              reason: option("--reason"),
              ...(cursorStepId ? { cursorStepId } : {}),
            },
          };
          break;
        }
        case "recovery-terminate":
        case "recovery-confirm":
        case "recovery-decide":
          input = { op: action, runId: needTarget(), request: requestFile() };
          break;
        default:
          throw new UsageError("unknown run command");
      }
    } else throw new UsageError("unknown command; use wf --help");
    if (options.size) throw new UsageError(`unknown option ${options.keys().next().value}`);
    if (daemon) {
      const owner = await startDaemon(directory);
      console.log(
        json
          ? JSON.stringify({ directory: owner.directory, status: "listening" })
          : `daemon listening; state: ${owner.directory}`,
      );
      const shutdown = () => {
        void owner.close().catch(() => {});
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      try {
        await owner.closed;
      } finally {
        process.off("SIGINT", shutdown);
        process.off("SIGTERM", shutdown);
      }
      return;
    }
    if (localValidation) {
      if (json) console.log(JSON.stringify(localValidation));
      else {
        for (const diagnostic of localValidation.diagnostics)
          console.log(formatDiagnostic(diagnostic, target ?? "workflow"));
        console.log(
          `${target}: ${localValidation.valid ? "valid" : "invalid"} (${localValidation.steps} steps, ${localValidation.diagnostics.filter((d) => d.severity === "warning").length} warnings)`,
        );
      }
      if (!localValidation.valid) process.exitCode = 1;
      return;
    }
    const request: ManagementRequest = managementRequestSchema.parse(input);
    const result = await managementRequest(directory, request);
    if (json) console.log(JSON.stringify(result));
    else if (request.op === "status") {
      const status = result as {
        run: { runId: string; status: string; cursorStepId: string; activeTaskId: string | null };
        expectedEventId: number;
      };
      console.log(
        `${status.run.runId}: ${status.run.status}, step ${status.run.cursorStepId}, task ${status.run.activeTaskId ?? "none"}\nexpectedEventId: ${status.expectedEventId}`,
      );
    } else console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const body =
      error instanceof ManagementError
        ? error.body
        : {
            error:
              error instanceof ZodError
                ? "invalid command fields"
                : error instanceof Error
                  ? error.message
                  : "management command failed",
          };
    if (json) console.error(JSON.stringify(body));
    else {
      console.error(body.error);
      if ("diagnostics" in body && Array.isArray(body.diagnostics))
        for (const d of body.diagnostics)
          console.error(formatDiagnostic(d as Diagnostic, diagnosticFile));
      if (error instanceof ZodError)
        for (const issue of error.issues)
          console.error(`${issue.path.join(".")}: ${issue.message}`);
    }
    process.exitCode =
      error instanceof UsageError || error instanceof InputError || error instanceof ZodError
        ? 2
        : 1;
  }
}

await managementMain();
