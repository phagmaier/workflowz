import { type FormEvent, useRef, useState } from "react";
import { ApiError, describeFailure } from "../api.ts";
import { useConnection } from "../connection.tsx";
import { harnessLabel, humanize } from "../lib/format.ts";
import type { HistoryItem } from "../lib/history.ts";
import { feedbackCurrent, type RunPlace } from "../lib/run-copy.ts";
import { runHref } from "../route.ts";
import type { RunData } from "../run-data.ts";
import { useRuns } from "../runs-data.tsx";
import type { BrowserRequest, BrowserRunStatus } from "../types.ts";
import { Feedback, type FeedbackState, forgetDraft, rememberDraft, useDraft } from "./ui.tsx";

type Control = Extract<BrowserRequest, { expectedEventId: number }>;
export interface LastResult {
  key: string;
  value: FeedbackState;
  sent?: RunPlace | null;
}

const placeOf = (status: BrowserRunStatus | null): RunPlace | null =>
  status ? { status: status.run.status, cursor: status.run.cursorStepId } : null;

/** Sends one deliberate control and reports the result where it was taken. Never retried. */
export function useControl(runId: string, refresh: () => void, status: BrowserRunStatus | null) {
  const { mutate } = useConnection();
  const runs = useRuns();
  const [result, setResult] = useState<LastResult>({ key: "", value: null });
  const send = async (key: string, request: Control, pending: string, done: string) => {
    const sent = placeOf(status);
    setResult({ key, value: { kind: "pending", text: pending } });
    try {
      await mutate(key, request);
      setResult({ key, value: { kind: "ok", text: done }, sent });
      return true;
    } catch (error) {
      const unknown = error instanceof ApiError && error.kind === "unreachable";
      setResult({
        key,
        value: { kind: unknown ? "unknown" : "error", text: describeFailure(error) },
      });
      return false;
    } finally {
      // Show the resulting state; the user decides whether to act again.
      refresh();
      runs.refresh();
    }
  };
  const now = placeOf(status);
  const stale =
    result.value?.kind === "ok" && result.sent && now && !feedbackCurrent(result.sent, now);
  return { result: stale ? { key: "", value: null } : result, send, runId };
}
type Controller = ReturnType<typeof useControl>;

function useCanAct(status: BrowserRunStatus | null) {
  const { busy, online, closing } = useConnection();
  return status !== null && busy === null && online && !closing;
}

function PermissionNote({
  status,
  compact = false,
}: {
  status: BrowserRunStatus;
  compact?: boolean;
}) {
  const agents = status.configuredPermissions;
  const consequence =
    "They can read and change any file your user can access, including outside the project. Stopping a run does not undo changes.";
  if (!agents.length)
    return (
      <p className="hint permission">
        This workflow has no agent steps. Its commands run as your user and can change any file you
        can access. Stopping a run does not undo changes.
      </p>
    );
  const byHarness = new Map<string, { mode: string | null; steps: string[] }>();
  for (const agent of agents) {
    const entry = byHarness.get(agent.harness) ?? { mode: agent.mode, steps: [] };
    entry.steps.push(humanize(agent.stepId));
    byHarness.set(agent.harness, entry);
  }
  return (
    <div className="permission">
      <p>
        <strong>{compact ? "Agents keep unrestricted permissions." : "Before you start:"}</strong>{" "}
        {compact ? consequence : `agent steps run with unrestricted permissions. ${consequence}`}
      </p>
      {compact ? null : (
        <ul>
          {[...byHarness].map(([harness, { mode, steps }]) => (
            <li key={harness}>
              {harnessLabel(harness)} — <code>{mode ?? "permission mode unknown"}</code> ·{" "}
              {steps.join(", ")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReasonField({
  id,
  draftKey,
  label = "Reason",
  required = true,
}: {
  id: string;
  draftKey: string;
  label?: string;
  required?: boolean;
}) {
  const [value, setValue] = useDraft(draftKey);
  return (
    <div className="block">
      <label htmlFor={id}>
        {label} <span className="muted">(saved in the run's history)</span>
      </label>
      <input
        id={id}
        name="reason"
        value={value}
        maxLength={4096}
        required={required}
        onChange={(event) => setValue(event.target.value)}
      />
    </div>
  );
}

/** Reads the reason from a submitted form; blank reasons are refused before anything is sent. */
function reasonOf(form: HTMLFormElement): string | null {
  const input = form.elements.namedItem("reason");
  if (!(input instanceof HTMLInputElement)) return null;
  const value = input.value.trim();
  if (!value) {
    input.setCustomValidity("Add a reason. It is saved in the run's history.");
    input.reportValidity();
    input.addEventListener("input", () => input.setCustomValidity(""), { once: true });
    input.focus();
    return null;
  }
  return value;
}

function StopControl({
  data,
  control,
  label,
  hint,
}: {
  data: RunData;
  control: Controller;
  label: string;
  hint: string;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const can = useCanAct(data.status);
  const status = data.status;
  if (!status) return null;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = reasonOf(event.currentTarget);
    if (!reason) return;
    const ok = await control.send(
      "stop",
      { op: "stop", runId: control.runId, expectedEventId: status.expectedEventId, reason },
      "Stopping and waiting for the process to exit…",
      "Stopped. Any running process was ended and cleaned up. File changes were kept.",
    );
    if (ok) forgetDraft(`${control.runId}:reason:stop`);
  };
  if (!open)
    return (
      <div className="stop">
        <button
          type="button"
          className="btn btn-quiet btn-danger-text"
          ref={toggle}
          onClick={() => setOpen(true)}
        >
          {label}
        </button>
        {control.result.key === "stop" ? <Feedback value={control.result.value} /> : null}
      </div>
    );
  return (
    <form className="stop-form" onSubmit={(event) => void submit(event)} noValidate>
      <p>
        <strong>Stop this run?</strong> {hint} Changes already made to files are kept. A stopped run
        can't be resumed.
      </p>
      <ReasonField id={`${control.runId}-stop-reason`} draftKey={`${control.runId}:reason:stop`} />
      <div className="row">
        <button className="btn btn-danger" type="submit" disabled={!can}>
          Stop run
        </button>
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => {
            setOpen(false);
            queueMicrotask(() => toggle.current?.focus());
          }}
        >
          Cancel
        </button>
        {control.result.key === "stop" ? <Feedback value={control.result.value} /> : null}
      </div>
    </form>
  );
}

type Choice = "resume" | "skip" | "jump" | "complete-task" | "edit";

function Decision({
  data,
  control,
  items,
}: {
  data: RunData;
  control: Controller;
  items: readonly HistoryItem[];
}) {
  const status = data.status as BrowserRunStatus;
  const { runId } = control;
  const can = useCanAct(status);
  const [choiceValue, setChoice] = useDraft(`${runId}:choice`);
  const [outcome, setOutcome] = useDraft(`${runId}:skip-outcome`);
  const [target, setTarget] = useDraft(`${runId}:jump-target`);
  const [taskValue, setTask] = useDraft(`${runId}:task`);
  const editingVersion = useRef(0);
  const cursor = status.run.cursorStepId;
  const step = humanize(cursor);
  const edit = data.runEdit;
  const pinned = edit !== null && edit.expectedEventId === status.expectedEventId;
  const current = edit?.steps.find((s) => s.stepId === cursor);
  const lastStep = [...items].reverse().find((item) => item.type === "step");
  const again =
    lastStep?.type === "step" && lastStep.stepId === cursor && lastStep.decision === "pause";
  const jumpTargets = edit?.steps.filter((s) => s.compatible && s.stepId !== cursor) ?? [];
  const openTasks = edit?.tasks.filter((task) => task.state !== "completed") ?? [];
  const task = openTasks.some((t) => t.taskId === taskValue)
    ? taskValue
    : (openTasks.find((t) => t.taskId === status.run.activeTaskId)?.taskId ??
      openTasks[0]?.taskId ??
      "");

  const options: { key: Choice; title: string; text: string }[] = [
    {
      key: "resume",
      title: again ? "Run this step again" : `Continue with ${step}`,
      text: again
        ? `${step} starts again from the beginning. Anything it already changed stays changed.`
        : `The run continues from ${step}.`,
    },
  ];
  if (current?.outcomes.length)
    options.push({
      key: "skip",
      title: `Decide ${step}'s result yourself`,
      text: `Choose ${current.outcomes.join(", ")}. Nothing runs; the run follows that result's rule and stays paused.`,
    });
  if (jumpTargets.length)
    options.push({
      key: "jump",
      title: "Continue from another step",
      text: "Choose where the run continues. Nothing runs now; the run stays paused.",
    });
  if (openTasks.length)
    options.push({
      key: "complete-task",
      title: "Mark this task done",
      text: "Records a task as done without running its remaining steps. The run stays paused.",
    });
  options.push({
    key: "edit",
    title: "Change the workflow for this run",
    text: "Edit prompts or rules for the rest of this run. The run stays paused.",
  });
  const choice = options.some((o) => o.key === choiceValue) ? (choiceValue as Choice) : null;

  const route = (value: string | undefined): string => {
    if (!value) return "";
    try {
      const action = JSON.parse(value) as { kind: string; target?: string };
      if (action.kind === "goto" && action.target)
        return `Then the next step will be ${humanize(action.target)}. The run stays paused until you resume.`;
      if (action.kind === "pause") return "Then the run stays paused at this step.";
      return "This result normally retries the step. A result you set can't retry, so the run stays paused here.";
    } catch {
      return "";
    }
  };

  const keys = ["resume", "skip", "jump", "complete-task"];
  const submit = async (event: FormEvent<HTMLFormElement>, key: Choice) => {
    event.preventDefault();
    const form = event.currentTarget;
    const reason = reasonOf(form);
    if (!reason) return;
    const sentVersion = editingVersion.current;
    let ok = false;
    if (key === "resume")
      ok = await control.send(
        "resume",
        { op: "resume", runId, expectedEventId: status.expectedEventId, reason },
        "Resuming…",
        `Resumed. ${step} ${again ? "runs again from the beginning" : "runs next"}.`,
      );
    else {
      if (!edit || !pinned) return;
      const base = { op: "override" as const, runId, expectedEventId: edit.expectedEventId };
      if (key === "skip") {
        if (!outcome) return;
        ok = await control.send(
          "skip",
          { ...base, edit: { action: "skip", outcome, reason } },
          "Recording…",
          `Recorded “${outcome}” for ${step}. Still paused — nothing runs until you resume.`,
        );
      } else if (key === "jump") {
        if (!target) return;
        ok = await control.send(
          "jump",
          { ...base, edit: { action: "jump", stepId: target, reason } },
          "Moving the run…",
          `Moved the run to ${humanize(target)}. Still paused — nothing runs until you resume.`,
        );
      } else if (key === "complete-task") {
        if (!task) return;
        const title = openTasks.find((t) => t.taskId === task)?.title ?? task;
        ok = await control.send(
          "complete-task",
          { ...base, edit: { action: "mark-task-complete", taskId: task, reason } },
          "Recording…",
          `Marked “${title}” done. Still paused — nothing runs until you resume.`,
        );
      }
    }
    if (ok && sentVersion === editingVersion.current) {
      forgetDraft(`${runId}:reason:${key}`);
      if (key !== "resume") rememberDraft(`${runId}:reason:resume`, reason);
      setChoice(key === "resume" ? "" : "resume");
      if (key !== "resume")
        requestAnimationFrame(() => {
          // Inspection stays available during Apply. Never pull focus away from that work.
          if (document.activeElement === document.body || form.contains(document.activeElement))
            document.getElementById(`${runId}-reason-resume`)?.focus();
        });
    }
  };
  const feedback = (key: string) =>
    control.result.key === key ? <Feedback value={control.result.value} /> : null;
  const stale = !pinned && choice !== null && choice !== "resume" && choice !== "edit";

  return (
    <>
      {keys.includes(control.result.key) && control.result.key !== choice ? (
        <p className="result-line">
          <Feedback value={control.result.value} />
        </p>
      ) : null}
      <fieldset className="choices" onChangeCapture={() => editingVersion.current++}>
        <legend>What should happen next?</legend>
        {!edit && data.runEditError ? (
          <p className="inline-alert">
            Other choices couldn't be loaded: {data.runEditError} You can still resume or stop.
          </p>
        ) : null}
        {options.map((option) => (
          <div key={option.key} className={`choice ${choice === option.key ? "current" : ""}`}>
            <label>
              <input
                type="radio"
                name={`${runId}-choice`}
                value={option.key}
                checked={choice === option.key}
                onChange={() => setChoice(option.key)}
              />
              <span>
                <strong>{option.title}</strong>
                <span className="muted">{option.text}</span>
              </span>
            </label>
            {choice === option.key ? (
              option.key === "edit" ? (
                <div className="decision-form">
                  <p className="hint">
                    Opens this run's workflow in the editor. Changes apply only to this run's
                    remaining steps; you give a reason there, and the run stays paused.
                  </p>
                  <a className="btn btn-primary" href={`${runHref(runId)}/edit`}>
                    Edit the workflow for this run
                  </a>
                </div>
              ) : (
                <form
                  className="decision-form"
                  noValidate
                  onSubmit={(event) => void submit(event, option.key)}
                >
                  {option.key === "resume" ? <PermissionNote status={status} compact /> : null}
                  {option.key === "skip" && current ? (
                    <>
                      <div className="block">
                        <label htmlFor={`${runId}-skip-outcome`}>{step}'s result</label>
                        <select
                          id={`${runId}-skip-outcome`}
                          value={current.outcomes.includes(outcome) ? outcome : ""}
                          onChange={(event) => setOutcome(event.target.value)}
                          required
                        >
                          <option value="">Choose a result…</option>
                          {current.outcomes.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      </div>
                      <p className="hint consequence">
                        {route(current.transitions[outcome]) ||
                          "No process runs and no report is created."}
                      </p>
                    </>
                  ) : null}
                  {option.key === "jump" ? (
                    <>
                      <div className="block">
                        <label htmlFor={`${runId}-jump-target`}>Continue at</label>
                        <select
                          id={`${runId}-jump-target`}
                          value={jumpTargets.some((s) => s.stepId === target) ? target : ""}
                          onChange={(event) => setTarget(event.target.value)}
                          required
                        >
                          <option value="">Choose a step…</option>
                          {jumpTargets.map((s) => (
                            <option key={s.stepId} value={s.stepId}>
                              {humanize(s.stepId)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <p className="hint consequence">
                        Task progress doesn't change. Running a step again can repeat what it did
                        before, such as commits.
                      </p>
                    </>
                  ) : null}
                  {option.key === "complete-task" ? (
                    <>
                      <div className="block">
                        <label htmlFor={`${runId}-task`}>Task</label>
                        <select
                          id={`${runId}-task`}
                          value={task}
                          onChange={(event) => setTask(event.target.value)}
                        >
                          {openTasks.map((t) => (
                            <option key={t.taskId} value={t.taskId}>
                              {t.title}
                              {t.taskId === status.run.activeTaskId ? " (current)" : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                      <p className="hint consequence">
                        {task === status.run.activeTaskId
                          ? `The run stays at ${step}. Before resuming you may want to move it to the step that picks the next task.`
                          : "The current task and step don't change."}
                      </p>
                    </>
                  ) : null}
                  <ReasonField
                    id={`${runId}-reason-${option.key}`}
                    draftKey={`${runId}:reason:${option.key}`}
                  />
                  <div className="row">
                    <button
                      className="btn btn-primary"
                      type="submit"
                      disabled={
                        !can ||
                        (option.key !== "resume" && !pinned) ||
                        (option.key === "skip" && !current?.outcomes.includes(outcome)) ||
                        (option.key === "jump" && !jumpTargets.some((s) => s.stepId === target)) ||
                        (option.key === "complete-task" && !task)
                      }
                    >
                      {
                        {
                          resume: "Resume run",
                          skip: "Apply",
                          jump: "Apply",
                          "complete-task": "Apply",
                        }[option.key]
                      }
                    </button>
                    {feedback(option.key)}
                  </div>
                  {stale && option.key === choice ? (
                    <p className="hint" role="status">
                      The run changed. Updating these choices…
                    </p>
                  ) : null}
                </form>
              )
            ) : null}
          </div>
        ))}
      </fieldset>
      <StopControl
        data={data}
        control={control}
        label="Stop this run…"
        hint="Nothing else runs in it."
      />
    </>
  );
}

function Recovery({ status }: { status: BrowserRunStatus }) {
  const attempt = status.activeAttempt;
  const blocking = status.attention.filter((item) => item.severity === "blocking").slice(-3);
  const process =
    attempt?.recoveryState === "gone"
      ? "Its process is confirmed gone."
      : attempt?.recoveryState === "alive"
        ? "Its process may still be running."
        : attempt
          ? "Whether its process is still running is not confirmed."
          : null;
  return (
    <div className="recovery">
      <h2 className="h3">Recovery happens in the terminal for now</h2>
      <ul className="known">
        <li>
          Step: <strong>{humanize(status.run.cursorStepId)}</strong>
          {attempt
            ? ` (attempt ${attempt.attemptId}, started ${new Date(attempt.startedAt).toLocaleString()})`
            : ""}
        </li>
        {process ? (
          <li>{process} Whether it changed files is unknown; check the project before deciding.</li>
        ) : null}
        {blocking.map((item) => (
          <li key={item.itemId}>{item.message}</li>
        ))}
      </ul>
      <p>Inspect what's known and the available decisions:</p>
      <pre className="out">wf run recovery {status.run.runId}</pre>
      <p className="hint">
        Decisions are retry, continue, skip with a result, jump to a step or end the run. Record one
        with <code>wf run recovery-decide {status.run.runId} --request decision.json</code>, then
        resume separately. Add the same <code>--state-dir</code> you started the daemon with.
        Nothing reruns automatically.
      </p>
    </div>
  );
}

export function RunControls({
  data,
  control,
  items,
}: {
  data: RunData;
  control: Controller;
  items: readonly HistoryItem[];
}) {
  const status = data.status;
  const can = useCanAct(status);
  if (!status) return null;
  const { run } = status;
  const step = humanize(run.cursorStepId);
  const { result } = control;
  const orphan = (keys: string[]) =>
    result.value && !keys.includes(result.key) ? (
      <p className="result-line">
        <Feedback value={result.value} />
      </p>
    ) : null;

  switch (run.status) {
    case "draft":
    case "ready":
      return (
        <section className="controls" aria-label="Run controls">
          {orphan(["start", "stop"])}
          <PermissionNote status={status} />
          <div className="row">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              disabled={!can}
              onClick={() =>
                void control.send(
                  "start",
                  { op: "start", runId: run.runId, expectedEventId: status.expectedEventId },
                  "Starting…",
                  "Started. It keeps going if you close this browser.",
                )
              }
            >
              Start run
            </button>
            {result.key === "start" ? <Feedback value={result.value} /> : null}
          </div>
          <StopControl
            data={data}
            control={control}
            label="Cancel this run…"
            hint="It never starts."
          />
        </section>
      );
    case "running":
      return (
        <section className="controls" aria-label="Run controls">
          {orphan(["pause", "stop"])}
          <div className="row">
            <button
              type="button"
              className="btn"
              disabled={!can}
              onClick={() =>
                void control.send(
                  "pause",
                  { op: "pause", runId: run.runId, expectedEventId: status.expectedEventId },
                  "Requesting pause…",
                  "Pause requested. The current step finishes first; nothing is cut off.",
                )
              }
            >
              Pause after this step
            </button>
            {result.key === "pause" ? <Feedback value={result.value} /> : null}
          </div>
          <StopControl
            data={data}
            control={control}
            label="Stop run now…"
            hint="The running step's process is ended and the daemon waits for it to exit."
          />
        </section>
      );
    case "pausing":
      return (
        <section className="controls" aria-label="Run controls">
          {orphan(["stop"])}
          <p className="muted">Waiting for {step} to finish, then the run pauses.</p>
          <StopControl
            data={data}
            control={control}
            label="Stop run now…"
            hint="The running step's process is ended and the daemon waits for it to exit."
          />
        </section>
      );
    case "paused":
      return (
        <section className="controls controls-decide" aria-label="Decide what happens next">
          {orphan(["resume", "skip", "jump", "complete-task", "stop"])}
          <Decision data={data} control={control} items={items} />
        </section>
      );
    case "interrupted":
      return (
        <section className="controls controls-danger" aria-label="Recovery">
          {orphan([])}
          <Recovery status={status} />
        </section>
      );
    default:
      // Earlier successes are history now; only the stop result belongs to a finished run.
      return result.value && result.key === "stop" ? (
        <section className="controls" aria-label="Run controls">
          {orphan([])}
        </section>
      ) : null;
  }
}
