import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiError, describeFailure, describeReadFailure } from "../api.ts";
import { useConnection, usePolling } from "../connection.tsx";
import {
  createSession,
  dropSession,
  rekey,
  type Session,
  type SessionState,
  sessionFor,
  useSession,
} from "../editor-session.ts";
import { setFlash } from "../flash.ts";
import { humanize, plural } from "../lib/format.ts";
import { type Doc, problems as explain, type Problem } from "../lib/workflow-edit.ts";
import { type EditorTab, type EditorTarget, editorHref, runHref, sessionKey } from "../route.ts";
import { useRuns } from "../runs-data.tsx";
import type { BrowserRunEdit, BrowserRunStatus, TaskImportPreview } from "../types.ts";
import { CheckerDock } from "./CheckerDock.tsx";
import { focusField } from "./editor-fields.tsx";
import { GraphTab } from "./GraphTab.tsx";
import { RevisionChanges } from "./RevisionChanges.tsx";
import { RulesTab } from "./RulesTab.tsx";
import { Shell } from "./Shell.tsx";
import { StepsTab } from "./StepsTab.tsx";
import { Feedback, type FeedbackState, forgetDraft, rememberDraft, useDraft } from "./ui.tsx";
import { YamlTab } from "./YamlTab.tsx";

const TABS: { id: EditorTab; label: string }[] = [
  { id: "map", label: "Graph" },
  { id: "steps", label: "Form" },
  { id: "project", label: "Project" },
  { id: "rules", label: "Rules & limits" },
  { id: "yaml", label: "YAML" },
];

/** A completed request still updates saved state, but cannot redirect a screen already left. */
function useActivePage() {
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return active;
}

/** Opens the session for a route the first time it is visited in this tab. */
function useOpen(target: EditorTarget): {
  session: Session | null;
  error: string | null;
  retry: () => void;
} {
  const { read } = useConnection();
  const key = sessionKey(target);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const session = sessionFor(key);
  if (session) session.read = read;

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs a failed open.
  useEffect(() => {
    if (sessionFor(key) || target.kind === "draft") return;
    let alive = true;
    (async () => {
      if (target.kind === "revision") {
        const source = await read<{ workflowText: string; workflowDir: string }>({
          op: "load",
          source: { revisionId: target.revisionId },
        });
        if (!alive || sessionFor(key)) return;
        const opened = createSession(key, "revision", source.workflowDir);
        opened.read = read;
        opened.set({ basedOn: target.revisionId, savedText: source.workflowText });
        await opened.open(source.workflowText);
      } else {
        const status = await read<BrowserRunStatus>({ op: "status", runId: target.runId });
        if (status.run.status !== "paused")
          throw new Error(
            `This run is ${status.run.status}. Only a paused run's workflow can be changed.`,
          );
        const edit = await read<BrowserRunEdit>({
          op: "run-edit",
          runId: target.runId,
          expectedEventId: status.expectedEventId,
        });
        if (!alive || sessionFor(key)) return;
        const opened = createSession(key, "run", edit.workflowDir);
        opened.read = read;
        opened.set({ run: edit, basedOn: edit.revisionId, savedText: edit.workflowText });
        await opened.open(edit.workflowText);
      }
    })().then(
      () => alive && setError(null),
      (failure: unknown) =>
        alive &&
        setError(
          failure instanceof ApiError
            ? describeReadFailure(failure)
            : failure instanceof Error
              ? failure.message
              : "Unknown error.",
        ),
    );
    return () => {
      alive = false;
    };
  }, [key, read, attempt]);
  return { session, error, retry: () => setAttempt(attempt + 1) };
}

function SaveState({ session, state }: { session: Session; state: SessionState }) {
  const [confirm, setConfirm] = useState(false);
  const dirty = session.dirty;
  const pill =
    state.kind === "run" ? (
      dirty ? (
        <span className="chip chip-attention">Changes not applied yet</span>
      ) : (
        <span className="chip">No changes yet</span>
      )
    ) : state.savedText === null ? (
      <span className="chip chip-attention">New draft · not saved yet</span>
    ) : dirty ? (
      <span className="chip chip-attention">Unsaved changes</span>
    ) : (
      <span className="chip chip-success">Saved</span>
    );
  const detail =
    state.kind === "run"
      ? `the run uses revision ${state.basedOn}`
      : state.basedOn
        ? dirty
          ? `based on revision ${state.basedOn}`
          : `revision ${state.basedOn}`
        : "";
  const discard = () => {
    setConfirm(false);
    if (state.kind === "new") {
      dropSession(session.key);
      window.location.hash = "#/workflows";
    } else if (state.kind === "run") {
      dropSession(session.key);
    } else if (state.savedText !== null) {
      session.set({ model: null });
      void session.open(state.savedText);
    }
  };
  return (
    <div className="status-line">
      {pill}
      {detail ? <span className="muted">{detail}</span> : null}
      {dirty && (state.model || state.mode === "text") ? (
        confirm ? (
          <span className="row confirm-inline">
            <span>{state.kind === "new" ? "Throw this draft away?" : "Discard your changes?"}</span>
            <button type="button" className="btn btn-sm btn-danger" onClick={discard}>
              Discard
            </button>
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => setConfirm(false)}
            >
              Keep editing
            </button>
          </span>
        ) : (
          <button type="button" className="link muted" onClick={() => setConfirm(true)}>
            {state.kind === "new" ? "Discard draft" : "Discard changes"}
          </button>
        )
      ) : null}
    </div>
  );
}

/** Why Save/Create/Apply is unavailable right now, or null when it is available. */
function blocker(session: Session, state: SessionState, list: readonly Problem[]): string | null {
  if (state.checking) return "Checking the latest change…";
  if (state.checkError) return "Not checked yet.";
  if (state.checked !== state.generation) return "Checking the latest change…";
  const errors = list.filter((p) => p.severity === "error").length;
  if (errors) return `Fix ${plural(errors, "problem")} first.`;
  return session.valid ? null : "Not checked yet.";
}

function CreateRunPanel({
  session,
  state,
  onClose,
}: {
  session: Session;
  state: SessionState;
  onClose: () => void;
}) {
  const { read, mutate, busy, online } = useConnection();
  const runs = useRuns();
  const [includeCompleted, setInclude] = useState(false);
  const [preview, setPreview] = useState<TaskImportPreview | null | undefined>(undefined);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const active = useActivePage();
  const heading = useRef<HTMLHeadingElement>(null);
  const doc = state.model;
  const valid = session.valid;
  const selection =
    valid && state.draft
      ? {
          source: { workflowText: state.text, workflowDir: state.workflowDir },
          projectRoot: state.draft.projectRoot ?? "",
          instructions: [...(state.draft.document?.project.instructions ?? [])],
          taskPath: state.draft.document?.tasks?.source.path ?? null,
          includeCompleted,
        }
      : null;
  const selectionKey = selection ? `${state.text}|${includeCompleted}` : "";

  useEffect(() => heading.current?.focus(), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectionKey captures what the preview depends on.
  useEffect(() => {
    if (!selection?.taskPath) {
      setPreview(null);
      return;
    }
    let alive = true;
    setPreview(undefined);
    setPreviewError(null);
    read<TaskImportPreview | null>({ op: "preview", ...selection }).then(
      (result) => {
        if (!alive) return;
        setPreview(result);
        setPreviewError(null);
      },
      (failure: unknown) => alive && setPreviewError(describeReadFailure(failure)),
    );
    return () => {
      alive = false;
    };
  }, [selectionKey, read, previewAttempt]);

  const create = async () => {
    if (!selection) return;
    const text = selection.source.workflowText;
    setFeedback({ kind: "pending", text: "Preparing the run…" });
    try {
      const { runId } = await mutate<{ runId: string }>("create", { op: "create", ...selection });
      try {
        const status = await read<BrowserRunStatus>({ op: "status", runId });
        if (session.state.text === text) session.saved(status.run.revisionId, text);
        setFlash(
          runId,
          `Run created from revision ${status.run.revisionId}. Nothing has started — check what will run, then choose Start.`,
          "ready",
          status.run.revisionId,
        );
      } catch {
        setFlash(
          runId,
          "Run created. Nothing has started — check what will run, then choose Start.",
          "ready",
        );
      }
      runs.refresh();
      if (active.current) window.location.hash = runHref(runId);
    } catch (error) {
      const unknown = error instanceof ApiError && error.kind === "unreachable";
      setFeedback({
        kind: unknown ? "unknown" : "error",
        text: unknown
          ? "No answer from the daemon, so it's unknown whether a run was created. Check Runs before trying again."
          : describeFailure(error).replace("The run changed since", "Something changed since"),
      });
      runs.refresh();
    }
  };

  const tasks = preview?.runnable ?? [];
  return (
    <section className="create-panel" aria-labelledby="create-title">
      <h2 id="create-title" tabIndex={-1} ref={heading}>
        Create a run
      </h2>
      <p>
        Prepares a run of <strong>{doc?.name ?? "this workflow"}</strong> from{" "}
        {session.dirty
          ? "this draft as shown, including unsaved changes (they are kept as a new revision with the run)"
          : `revision ${state.basedOn}`}
        . <strong>Nothing runs yet</strong>: the run's page opens, and you choose Start there.
      </p>
      {!valid ? (
        <p className="inline-alert">
          {blocker(session, state, explain(state.draft?.diagnostics ?? [], doc)) ??
            "Not checked yet."}
        </p>
      ) : selection?.taskPath ? (
        previewError ? (
          <p className="inline-alert" role="alert">
            The task list couldn't be read: {previewError}{" "}
            <button
              type="button"
              className="btn btn-sm"
              disabled={!online}
              onClick={() => setPreviewAttempt((attempt) => attempt + 1)}
            >
              Try again
            </button>
          </p>
        ) : preview === undefined ? (
          <p className="muted" role="status">
            <span className="spinner" aria-hidden="true" /> Reading {selection.taskPath}…
          </p>
        ) : preview ? (
          <>
            <p>
              <strong>{plural(preview.runnableCount, "task")}</strong> will be copied from{" "}
              <code>{selection.taskPath}</code> into the run. Later edits to the file don't change
              it.
            </p>
            {tasks.length ? (
              <ol className="task-list compact">
                {tasks.slice(0, 8).map((task) => (
                  <li key={task.sourceOrder}>{task.title}</li>
                ))}
                {tasks.length > 8 ? <li className="muted">and {tasks.length - 8} more</li> : null}
              </ol>
            ) : null}
            <details className="disclosure">
              <summary>All checklist items</summary>
              <ol className="task-list">
                {preview.tasks.map((task) => (
                  <li key={task.sourceOrder}>
                    <strong>{task.title}</strong>
                    <p className="hint">
                      {tasks.some((t) => t.sourceOrder === task.sourceOrder)
                        ? "Queued"
                        : "Excluded"}{" "}
                      · line {task.sourceLine}
                      {task.sourceChecked ? " · checked in the file" : ""}
                      {task.headingPath.length ? ` · ${task.headingPath.join(" / ")}` : ""}
                    </p>
                    {task.body ? <p className="prose">{task.body}</p> : null}
                  </li>
                ))}
              </ol>
            </details>
            {preview.prechecked ? (
              <label className="check">
                <input
                  type="checkbox"
                  checked={includeCompleted}
                  onChange={(event) => setInclude(event.target.checked)}
                />{" "}
                Also include the {plural(preview.prechecked, "task")} already checked off in the
                file
              </label>
            ) : null}
          </>
        ) : null
      ) : (
        <p className="muted">
          This workflow has no task checklist, so the run goes through its steps once.
        </p>
      )}
      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={
            !selection || busy !== null || !online || (selection.taskPath !== null && !preview)
          }
          onClick={() => void create()}
        >
          Create run
        </button>
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          Cancel
        </button>
        <Feedback value={feedback} />
      </div>
    </section>
  );
}

function RunEditBar({
  session,
  state,
  list,
}: {
  session: Session;
  state: SessionState;
  list: readonly Problem[];
}) {
  const { read, mutate, busy, online } = useConnection();
  const runs = useRuns();
  const run = state.run as BrowserRunEdit;
  const doc = state.model;
  const [reason, setReason] = useDraft(`${run.runId}:reason:revise`);
  const [cursor, setCursor] = useDraft(`${run.runId}:revise-cursor`);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [recheck, setRecheck] = useState<FeedbackState>(null);
  const active = useActivePage();
  const previous = run.steps.find((s) => s.stepId === run.cursorStepId);
  const here = doc?.steps[run.cursorStepId];
  const preflight = session.current ? state.draft?.revision : undefined;
  const stays = preflight?.keepCursor === true;
  const targets = preflight?.steps ?? [];
  const chosen = targets.some((s) => s.stepId === cursor && s.compatible) ? cursor : "";
  const reasonOk = reason.trim().length > 0;
  const why = blocker(session, state, list);
  const can =
    !why &&
    !!preflight &&
    !preflight.constraints.length &&
    !state.stale &&
    session.dirty &&
    busy === null &&
    online &&
    (stays || chosen !== "");

  // Notice when the run moves on, so a stale Apply is explained before it is refused.
  usePolling(async () => {
    const status = await read<BrowserRunStatus>({ op: "status", runId: run.runId });
    if (status.expectedEventId !== run.expectedEventId || status.run.status !== "paused")
      session.set({ stale: true });
  }, 5000);

  const reinspect = async () => {
    setRecheck({ kind: "pending", text: "Reading the run…" });
    try {
      const status = await read<BrowserRunStatus>({ op: "status", runId: run.runId });
      if (status.run.status !== "paused")
        return setRecheck({
          kind: "error",
          text: `The run is ${status.run.status} now, so its workflow can't be changed. Your edits are kept in this tab.`,
        });
      const fresh = await read<BrowserRunEdit>({
        op: "run-edit",
        runId: run.runId,
        expectedEventId: status.expectedEventId,
      });
      if (fresh.revisionId !== run.revisionId)
        return setRecheck({
          kind: "error",
          text: "The run's workflow was changed somewhere else. Discard your changes to start from its current workflow.",
        });
      session.set({ run: fresh, stale: false });
      session.recheck();
      setRecheck({ kind: "ok", text: "Up to date with the run again. Your edits were kept." });
    } catch (error) {
      setRecheck({ kind: "error", text: describeReadFailure(error) });
    }
  };

  const apply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("reason");
    if (!reasonOk) {
      if (input instanceof HTMLInputElement) {
        input.setCustomValidity("Add a reason. It is saved in the run's history.");
        input.reportValidity();
        input.addEventListener("input", () => input.setCustomValidity(""), { once: true });
        input.focus();
      }
      return;
    }
    if (!can) return;
    setFeedback({ kind: "pending", text: "Applying to the run…" });
    try {
      const result = await mutate<{ revisionId: number }>("revise", {
        op: "revise",
        runId: run.runId,
        expectedEventId: run.expectedEventId,
        edit: {
          workflowText: state.text,
          reason: reason.trim(),
          ...(chosen ? { cursorStepId: chosen } : {}),
        },
      });
      forgetDraft(`${run.runId}:reason:revise`);
      forgetDraft(`${run.runId}:revise-cursor`);
      setFlash(
        run.runId,
        `Workflow changed for this run (now revision ${result.revisionId}). Still paused — resume when you're ready.`,
        "paused",
        result.revisionId,
      );
      rememberDraft(`${run.runId}:choice`, "resume");
      dropSession(session.key);
      runs.refresh();
      if (active.current) window.location.hash = runHref(run.runId);
    } catch (error) {
      if (error instanceof ApiError && error.kind === "stale") session.set({ stale: true });
      setFeedback({
        kind: error instanceof ApiError && error.kind === "unreachable" ? "unknown" : "error",
        text:
          error instanceof ApiError && error.kind === "stale"
            ? "Not applied. The run changed since this editor opened, so nothing changed. Your edits are kept; check the run again, then apply."
            : describeFailure(error),
      });
      runs.refresh();
    }
  };

  return (
    <form className="run-edit" onSubmit={(event) => void apply(event)} noValidate>
      <p>
        <strong>You're changing the workflow for this paused run only.</strong> Saved workflows
        don't change. Finished steps and history stay as they are, files aren't touched, and the run
        stays paused until you resume it.
      </p>
      {state.stale ? (
        <div className="inline-alert" role="alert">
          The run changed since this editor opened, so applying would be refused. Your edits are
          kept.{" "}
          <button type="button" className="btn btn-sm" onClick={() => void reinspect()}>
            Check the run again
          </button>{" "}
          <Feedback value={recheck} />
        </div>
      ) : recheck?.kind === "ok" ? (
        <p>
          <Feedback value={recheck} />
        </p>
      ) : null}
      <RevisionChanges state={state} />
      <p className="hint">
        {run.activeTaskId
          ? `Current task: ${run.tasks.find((t) => t.taskId === run.activeTaskId)?.title ?? "active"}. Finish or explicitly complete it before picking another task.`
          : "There is no active task. Steps that need task values or mark a task done are unavailable until a task is picked."}{" "}
        Agent sessions from the previous revision cannot be resumed.
      </p>
      {preflight?.constraints.map((text) => (
        <p key={text} className="inline-alert" role="alert">
          {text}
        </p>
      ))}
      <div className="grid2">
        <div className="block">
          <label htmlFor="revise-cursor">Continue at</label>
          <select
            id="revise-cursor"
            value={chosen}
            onChange={(event) => setCursor(event.target.value)}
          >
            {stays ? (
              <option value="">Where it is now — {humanize(run.cursorStepId)}</option>
            ) : (
              <option value="" disabled>
                Choose a step…
              </option>
            )}
            {targets
              .filter((s) => s.stepId !== run.cursorStepId || !stays)
              .map((s) => (
                <option key={s.stepId} value={s.stepId} disabled={!s.compatible}>
                  {humanize(s.stepId)}
                  {!s.compatible ? " — unavailable" : ""}
                </option>
              ))}
          </select>
          {!stays && preflight && !chosen ? (
            <span className="field-err">
              {humanize(run.cursorStepId)}, where the run is paused,{" "}
              {!here
                ? "is no longer in the workflow"
                : here.kind !== previous?.kind
                  ? "is a different kind of step now"
                  : "cannot continue with the current task state"}
              . Choose where it continues.
            </span>
          ) : (
            <span className="hint">
              {chosen ? `On Resume, ${humanize(chosen)} runs from the beginning. ` : ""}Nothing runs
              when you apply. Resume afterwards to continue.
            </span>
          )}
        </div>
        <div className="block">
          <label htmlFor="revise-reason">
            Reason <span className="muted">(saved in the run's history)</span>
          </label>
          <input
            id="revise-reason"
            name="reason"
            value={reason}
            maxLength={4096}
            required
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </div>
      {targets.some((s) => !s.compatible) ? (
        <details className="disclosure">
          <summary>Why some steps are unavailable</summary>
          <ul>
            {targets
              .filter((s) => !s.compatible)
              .map((s) => (
                <li key={s.stepId}>
                  <strong>{humanize(s.stepId)}</strong>:{" "}
                  {doc?.steps[s.stepId]?.kind === "task.next"
                    ? "A task is still active. Finish it before picking another."
                    : "Needs an active task. Pick a task first."}
                </li>
              ))}
          </ul>
        </details>
      ) : null}
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={!can}>
          Apply to this run
        </button>
        <a className="btn btn-quiet" href={runHref(run.runId)}>
          Back to the run
        </a>
        <Feedback value={feedback} />
        {!feedback && (why || !session.dirty) ? (
          <span className="hint">{why ?? "Make a change to the workflow first."}</span>
        ) : null}
      </div>
    </form>
  );
}

function ProjectTab({
  session,
  state,
  list,
}: {
  session: Session;
  state: SessionState;
  list: readonly Problem[];
}) {
  const doc = state.model as Doc;
  const locked = state.kind === "run";
  const [name, setName] = useState(doc.name);
  const [root, setRoot] = useState(doc.project.root);
  const [instructions, setInstructions] = useState((doc.project.instructions ?? []).join("\n"));
  const [tasks, setTasks] = useState(doc.tasks?.source.path ?? "");
  const errorsFor = (field: string) =>
    list.filter((p) => p.place === "project" && p.field === field).map((p) => p.text);
  const commit = (next: { root?: string; instructions?: string; tasks?: string }) =>
    session.edit((d) => {
      const r = next.root ?? root;
      const i = (next.instructions ?? instructions)
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const t = (next.tasks ?? tasks).trim();
      const project: Doc["project"] = { root: r.trim() || "." };
      if (i.length) project.instructions = i;
      const out: Doc = { ...d, project };
      if (t) out.tasks = { source: { kind: "markdown_checklist", path: t } };
      else delete out.tasks;
      return out;
    }, 400);
  const field = (id: string, field: string) => {
    const errors = errorsFor(field);
    return errors.length
      ? {
          "aria-invalid": true as const,
          "aria-describedby": `${id}-err`,
          className: "mono invalid",
        }
      : { className: "mono" };
  };
  const errorText = (id: string, field: string) => {
    const errors = errorsFor(field);
    return errors.length ? (
      <span className="field-err" id={`${id}-err`}>
        {errors.join(" ")}
      </span>
    ) : null;
  };
  return (
    <div className="narrow">
      <section className="pane">
        <h2>Project</h2>
        <p className="muted">Where the steps work and what every agent reads first.</p>
        {locked ? (
          <p className="callout">
            A run keeps its project folder and task list. To use different ones, create a new run
            from a saved workflow.
          </p>
        ) : null}
        <div className="block">
          <label htmlFor="workflow-name">Workflow name</label>
          <input
            id="workflow-name"
            value={name}
            maxLength={200}
            aria-invalid={list.some((p) => p.place === "name") || undefined}
            onChange={(event) => {
              const value = event.target.value;
              setName(value);
              session.edit((d) => ({ ...d, name: value }), 400);
            }}
          />
          {list
            .filter((p) => p.place === "name")
            .map((p) => (
              <span key={p.text} className="field-err">
                {p.text}
              </span>
            ))}
        </div>
        <div className="block">
          <label htmlFor="project-root">Project folder</label>
          <input
            id="project-root"
            value={root}
            disabled={locked}
            {...field("project-root", "root")}
            onChange={(event) => {
              setRoot(event.target.value);
              commit({ root: event.target.value });
            }}
          />
          {errorText("project-root", "root")}
          {state.draft?.projectRoot && state.draft.projectRoot !== root ? (
            <span className="hint">
              Resolves to <code>{state.draft.projectRoot}</code>
            </span>
          ) : null}
        </div>
        <div className="block">
          <label htmlFor="project-instructions">
            Instruction files given to every agent — one per line, in order
          </label>
          <textarea
            id="project-instructions"
            rows={3}
            value={instructions}
            {...field("project-instructions", "instructions")}
            onChange={(event) => {
              setInstructions(event.target.value);
              commit({ instructions: event.target.value });
            }}
          />
          {errorText("project-instructions", "instructions")}
          <span className="hint">Paths are relative to the project folder.</span>
        </div>
        <div className="block">
          <label htmlFor="project-tasks">Task checklist (Markdown)</label>
          <input
            id="project-tasks"
            value={tasks}
            disabled={locked}
            placeholder="Leave empty if this workflow has no tasks"
            {...field("project-tasks", "tasks")}
            onChange={(event) => {
              setTasks(event.target.value);
              commit({ tasks: event.target.value });
            }}
          />
          {errorText("project-tasks", "tasks")}
          <span className="hint">
            Unchecked items are copied into each run when it is created. Editing the file later
            doesn't change existing runs, and Workflowz never ticks boxes in it.
          </span>
        </div>
        <details className="disclosure">
          <summary>
            Workflow folder <span className="muted mono">— {state.workflowDir}</span>
          </summary>
          <p className="hint">
            A relative project folder starts from here. It is fixed for a saved workflow and its
            runs.
          </p>
        </details>
      </section>
    </div>
  );
}

export function EditorPage({ target, tab }: { target: EditorTarget; tab: EditorTab }) {
  const opened = useOpen(target);
  const { session } = opened;
  const state = useSession(session);
  const { mutate, busy, online } = useConnection();
  const runs = useRuns();
  const [saveFb, setSaveFb] = useState<FeedbackState>(null);
  const [creating, setCreating] = useState(false);
  const [fixTarget, setFixTarget] = useState<{ tab: EditorTab; id: string } | null>(null);
  useEffect(() => {
    if (fixTarget && fixTarget.tab === tab) {
      focusField(fixTarget.id, fixTarget.tab === "map" ? "step-title" : undefined);
      setFixTarget(null);
    }
  }, [fixTarget, tab]);
  const routeKey = sessionKey(target);
  const savedKey = session?.key;
  // The currently visible editor owns navigation after a save. It may be a new mount of the
  // same draft while an older screen's request is still pending; its address must match the
  // saved revision without redirecting unrelated screens or changing the current editor tab.
  useEffect(() => {
    if (savedKey?.startsWith("rev:") && savedKey !== routeKey)
      window.location.replace(
        editorHref({ kind: "revision", revisionId: Number(savedKey.slice(4)) }, tab),
      );
  }, [savedKey, routeKey, tab]);
  const createButton = useRef<HTMLButtonElement>(null);
  const runMode = target.kind === "run";
  const name = state?.model?.name || (runMode ? "Workflow" : "Untitled workflow");
  const crumbs = runMode
    ? [
        { label: "Runs", href: "#/runs" },
        { label: target.runId, href: runHref(target.runId) },
        { label: "Change the workflow for this run" },
      ]
    : [{ label: "Workflows", href: "#/workflows" }, { label: name }];
  const pageKey = `editor:${state?.uid ?? sessionKey(target)}`;

  if (!session || !state || (!state.model && state.mode !== "text")) {
    const gone = target.kind === "draft" && !session;
    const error =
      opened.error ??
      state?.loadError ??
      (state?.checkError && !state.draft ? state.checkError : null);
    return (
      <Shell section={runMode ? "runs" : "workflows"} crumbs={crumbs} pageKey={pageKey}>
        <h1 tabIndex={-1} data-placeholder={gone || error ? undefined : ""}>
          {gone
            ? "This draft is gone"
            : error
              ? "This workflow couldn't be opened"
              : "Opening the workflow…"}
        </h1>
        {gone ? (
          <div className="state-panel">
            <p>
              Unsaved drafts live only in the browser tab that created them, so reloading or opening
              a new tab loses them.
            </p>
            <p>
              <a className="btn btn-primary" href="#/workflows/new">
                Create a workflow
              </a>{" "}
              <a href="#/workflows">Back to Workflows</a>
            </p>
          </div>
        ) : error ? (
          <div className="state-panel" role="alert">
            <p>{error}</p>
            <p>
              {opened.error ? (
                <button type="button" className="btn" onClick={opened.retry}>
                  Try again
                </button>
              ) : session && !state?.loadError ? (
                <button type="button" className="btn" onClick={() => session.recheck()}>
                  Try again
                </button>
              ) : null}{" "}
              <a href={runMode ? runHref(target.runId) : "#/workflows"}>
                {runMode ? "Back to the run" : "Back to Workflows"}
              </a>
            </p>
          </div>
        ) : (
          <p className="muted" role="status">
            <span className="spinner" aria-hidden="true" /> Reading and checking the workflow…
          </p>
        )}
      </Shell>
    );
  }

  const doc = state.model;
  const list = explain(state.draft?.diagnostics ?? [], doc);
  const why = blocker(session, state, list);
  const errorCount = (place: string) =>
    list.filter(
      (p) =>
        p.severity === "error" &&
        (place === "steps"
          ? p.place === "steps" || p.place === "start"
          : place === "project"
            ? p.place === "project" || p.place === "name"
            : p.place === place),
    ).length;

  const save = async () => {
    if (!session.valid || !state.draft?.document) return;
    const text = state.text;
    const draftDoc = state.draft.document;
    setSaveFb({ kind: "pending", text: "Saving…" });
    try {
      const result = await mutate<{ revisionId: number }>("save", {
        op: "save",
        source: { workflowText: text, workflowDir: state.workflowDir },
        projectRoot: state.draft.projectRoot ?? "",
        instructions: [...(draftDoc.project.instructions ?? [])],
        taskPath: draftDoc.tasks?.source.path ?? null,
        includeCompleted: false,
      });
      const unchanged = result.revisionId === state.basedOn;
      session.saved(result.revisionId, text);
      setSaveFb({
        kind: "ok",
        text: unchanged
          ? `Nothing new to save — this is revision ${result.revisionId}.`
          : `Saved as revision ${result.revisionId}. No run was created.`,
      });
      const key = `rev:${result.revisionId}`;
      if (session.key !== key) rekey(session, key);
      runs.refresh();
    } catch (error) {
      const unknown = error instanceof ApiError && error.kind === "unreachable";
      setSaveFb({
        kind: unknown ? "unknown" : "error",
        text: unknown
          ? "No answer from the daemon, so it's unknown whether this was saved. Check Workflows before saving again."
          : describeFailure(error),
      });
    }
  };

  const actions = runMode ? (
    <a className="btn" href={runHref(target.runId)}>
      Back to the run
    </a>
  ) : (
    <>
      <span className="act-group">
        <Feedback value={saveFb} />
        <button
          type="button"
          className={`btn ${session.dirty ? "btn-primary" : ""}`}
          disabled={!!why || !session.dirty || busy !== null || !online}
          title={
            why ?? (session.dirty ? "Saves a new revision. Nothing runs." : "No unsaved changes")
          }
          onClick={() => void save()}
        >
          Save
        </button>
      </span>
      <button
        type="button"
        ref={createButton}
        className={`btn ${session.dirty ? "" : "btn-primary"}`}
        aria-expanded={creating}
        onClick={() => setCreating(!creating)}
      >
        Create run…
      </button>
    </>
  );

  const href = (t: EditorTab) => editorHref(target, t);
  const fix = (problem: Problem) => {
    let destination: EditorTab = "map";
    let id = "step-title";
    if (state.mode === "text" || problem.place === "yaml") {
      destination = "yaml";
      id = "workflow-yaml";
      if (state.mode !== "text") session.enterText();
    } else if (problem.code === "unbounded_cycle" || problem.place === "rules") {
      destination = "rules";
      id = problem.code === "unbounded_cycle" ? "limits-title" : (problem.field ?? "shared-title");
    } else if (
      problem.code === "tasks_required" ||
      problem.place === "project" ||
      problem.place === "name"
    ) {
      destination = "project";
      id =
        problem.place === "name"
          ? "workflow-name"
          : problem.code === "tasks_required"
            ? "project-tasks"
            : `project-${problem.field ?? "root"}`;
    } else if (problem.place === "start") id = "start-step";
    else if (problem.stepId && doc?.steps[problem.stepId]) {
      session.set({ selected: problem.stepId });
      const field = problem.outcome ?? problem.field;
      id =
        field === "outcomes"
          ? `${problem.stepId}-next`
          : field && !["on", "kind"].includes(field)
            ? `f-${problem.stepId}-${field}`
            : "step-title";
    } else {
      destination = "yaml";
      id = "workflow-yaml";
      session.enterText();
    }
    setFixTarget({ tab: destination, id });
    window.location.hash = href(destination);
  };
  return (
    <Shell
      section={runMode ? "runs" : "workflows"}
      crumbs={crumbs}
      actions={actions}
      pageKey={pageKey}
    >
      <div className="editor-head">
        <div className="kind-label">{runMode ? "Workflow of a paused run" : "Workflow"}</div>
        <h1 tabIndex={-1}>{name}</h1>
        <SaveState session={session} state={state} />
        {why && why !== "Checking the latest change…" && !runMode ? (
          <p className="hint">Save and Create run need a checked workflow. {why}</p>
        ) : null}
      </div>
      {runMode && state.run ? <RunEditBar session={session} state={state} list={list} /> : null}
      {creating && !runMode ? (
        <CreateRunPanel
          session={session}
          state={state}
          onClose={() => {
            setCreating(false);
            queueMicrotask(() => createButton.current?.focus());
          }}
        />
      ) : null}
      <nav className="tabs" aria-label="Editor views">
        {TABS.map((t) => {
          const count =
            t.id === "map" || t.id === "yaml"
              ? t.id === "yaml"
                ? errorCount("yaml")
                : 0
              : errorCount(t.id);
          return (
            <a
              key={t.id}
              href={href(t.id)}
              className={tab === t.id ? "current" : ""}
              aria-current={tab === t.id ? "page" : undefined}
            >
              {t.label}
              {count ? (
                <span className="count-err">
                  {count}
                  <span className="sr-only"> to fix</span>
                </span>
              ) : null}
            </a>
          );
        })}
      </nav>
      {state.mode === "text" && tab !== "yaml" ? (
        <section className="pane">
          <h2>Visual editing is paused</h2>
          <p>
            Your YAML text is the source of truth. Check it and return to visual editing on the YAML
            tab.
          </p>
          <a className="btn" href={href("yaml")}>
            Continue editing YAML
          </a>
        </section>
      ) : tab === "steps" ? (
        <StepsTab key={state.opened} session={session} state={state} problems={list} />
      ) : tab === "project" ? (
        <ProjectTab key={state.opened} session={session} state={state} list={list} />
      ) : tab === "rules" ? (
        <RulesTab key={state.opened} session={session} state={state} list={list} />
      ) : tab === "yaml" ? (
        <YamlTab session={session} state={state} />
      ) : (
        <GraphTab key={state.opened} session={session} state={state} problems={list} />
      )}
      {tab !== "steps" ? (
        <CheckerDock session={session} state={state} problems={list} onFix={fix} />
      ) : null}
    </Shell>
  );
}
