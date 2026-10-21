import { useEffect, useMemo, useState } from "react";
import { clearFlash, peekFlash } from "../flash.ts";
import { clock, duration, humanize, KIND_LABEL } from "../lib/format.ts";
import { buildHistory, type HistoryItem, redact } from "../lib/history.ts";
import { describeRun } from "../lib/run-copy.ts";
import { runHref } from "../route.ts";
import { type RunData, useRunData } from "../run-data.ts";
import { useRuns } from "../runs-data.tsx";
import { History, StepDetail } from "./History.tsx";
import { RunControls, useControl } from "./RunControls.tsx";
import { RunMap } from "./RunMap.tsx";
import { Shell } from "./Shell.tsx";
import { StatusChip } from "./ui.tsx";

function Facts({ data }: { data: RunData }) {
  const status = data.status;
  if (!status) return null;
  const { run, progress, tasks } = status;
  const task = tasks.find((t) => t.taskId === run.activeTaskId);
  const finished = run.status === "completed" || run.status === "stopped";
  const step = data.graph?.specs[run.cursorStepId];
  return (
    <dl className="facts">
      <div>
        <dt>Task</dt>
        <dd>
          {task
            ? `${tasks.indexOf(task) + 1} of ${tasks.length} · ${task.title}`
            : progress
              ? progress.completed === progress.total && progress.total > 0
                ? `All ${progress.total} done`
                : `${progress.completed} of ${progress.total} done · none active`
              : "No task list"}
        </dd>
      </div>
      <div>
        <dt>{finished ? "Last step" : run.status === "running" ? "Current step" : "Next step"}</dt>
        <dd>
          {humanize(run.cursorStepId)}
          {step ? <span className="muted"> · {KIND_LABEL[step.kind]}</span> : null}
        </dd>
      </div>
      <div>
        <dt>Elapsed</dt>
        <dd>
          {run.startTime ? (
            <>
              {duration(status.elapsedMs)} <span className="muted">incl. pauses</span>
            </>
          ) : (
            "Not started"
          )}
        </dd>
      </div>
      {progress ? (
        <div>
          <dt>Progress</dt>
          <dd className="progress">
            <progress
              max={Math.max(progress.total, 1)}
              value={progress.completed}
              aria-label="Tasks done"
            />{" "}
            {progress.completed}/{progress.total} tasks
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

function ReadyPlan({ data }: { data: RunData }) {
  const { graph, status } = data;
  if (!status) return null;
  return (
    <section className="pane plan" aria-labelledby="plan-title">
      <h2 id="plan-title">What will run</h2>
      {graph ? (
        <ol className="plan-list">
          {graph.steps.map((step) => (
            <li key={step.id}>
              <strong>{humanize(step.id)}</strong>{" "}
              <span className="muted">
                {KIND_LABEL[step.kind]}
                {step.kind === "agent" || step.kind === "command" ? ` · ${step.detail}` : ""}
                {step.id === graph.start ? " · runs first" : ""}
              </span>
              <div className="muted small">
                {(graph.transitions[step.id] ?? [])
                  .filter((t) => !t.outcome.startsWith("system."))
                  .map((t) =>
                    t.action.kind === "goto"
                      ? `${t.outcome} → ${humanize(t.action.target)}`
                      : t.action.kind === "pause"
                        ? `${t.outcome} → pause for you`
                        : `${t.outcome} → retry`,
                  )
                  .join(" · ")}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">{data.graphError ?? "Loading the steps…"}</p>
      )}
      {status.tasks.length ? (
        <>
          <h3 className="h3">Tasks imported when the run was created</h3>
          <ol className="task-list">
            {status.tasks.map((task) => (
              <li key={task.taskId}>{task.title}</li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}

export function RunPage({ runId, tab }: { runId: string; tab: "details" | "map" }) {
  const data = useRunData(runId);
  const { names } = useRuns();
  const control = useControl(runId, data.refresh);
  const { status, events, reports } = data;
  const items = useMemo<HistoryItem[]>(() => buildHistory(events, reports), [events, reports]);
  const [picked, setPicked] = useState<string | null>(null);
  // A confirmation from the page that sent us here (a created run, an applied change).
  const [flash, setFlash] = useState(() => peekFlash(runId));
  useEffect(() => {
    clearFlash(runId);
  }, [runId]);
  useEffect(() => {
    if (
      flash &&
      status &&
      (status.run.status !== flash.status ||
        (flash.revisionId !== undefined && status.run.revisionId !== flash.revisionId) ||
        control.result.value !== null)
    )
      setFlash(null);
  }, [flash, status, control.result.value]);
  // Follow the newest step until the user picks something to read.
  const latest = [...items].reverse().find((item) => item.type === "step") ?? items.at(-1);
  const selected = items.find((item) => item.id === picked) ?? latest;
  const name = data.graph?.name ?? (status ? names.get(status.run.revisionId) : undefined) ?? "Run";
  const crumbs = [{ label: "Runs", href: "#/runs" }, { label: `${name} · ${runId}` }];

  if (!status)
    return (
      <Shell section="runs" crumbs={crumbs} pageKey={`run:${runId}`}>
        <h1 tabIndex={-1} data-placeholder="">
          {data.error ? "This run couldn't be loaded" : "Loading run…"}
        </h1>
        {data.error ? (
          <div className="state-panel" role="alert">
            <p>{data.error}</p>
            <p>
              <button type="button" className="btn" onClick={data.refresh}>
                Try again now
              </button>{" "}
              <a href="#/runs">Back to runs</a>
            </p>
          </div>
        ) : (
          <p className="muted" role="status">
            <span className="spinner" aria-hidden="true" /> Reading the run's status and history…
          </p>
        )}
      </Shell>
    );

  const copy = describeRun(status, items);
  const showInHistory = (stepId: string) => {
    const item = [...items].reverse().find((i) => i.type === "step" && i.stepId === stepId);
    if (item) setPicked(item.id);
    window.location.hash = runHref(runId);
  };

  return (
    <Shell section="runs" crumbs={crumbs} pageKey={`run:${runId}`}>
      {flash ? (
        <div className="result-line flash" role="status">
          <span className="fb fb-ok">{flash.text}</span>
          <button type="button" className="link" onClick={() => setFlash(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      <section className="run-head">
        <div className="run-title">
          <div className="kind-label">
            {name} · <span className="mono">{runId}</span> · revision {status.run.revisionId}
            {status.run.startTime ? ` · started ${clock(status.run.startTime)}` : ""}
          </div>
          <h1 tabIndex={-1}>
            <StatusChip status={status.run.status} /> {copy.headline}
          </h1>
          <p className="lede">{copy.detail}</p>
          {data.error ? (
            <p className="inline-alert" role="alert">
              {data.error} Showing the last known state.
            </p>
          ) : null}
        </div>
        <Facts data={data} />
      </section>

      <RunControls data={data} control={control} items={items} />

      <details className="disclosure pane">
        <summary>Run information</summary>
        <dl className="kv">
          <dt>Project folder</dt>
          <dd className="mono">{status.run.projectRoot}</dd>
          <dt>Created</dt>
          <dd>{status.run.createdAt}</dd>
        </dl>
        {status.tasks.length ? (
          <section aria-label="Imported tasks">
            <h2 className="h3">Imported tasks</h2>
            {status.tasks.map((task) => (
              <details className="disclosure" key={task.taskId}>
                <summary>
                  {task.title} · {task.state}
                  {task.taskId === status.run.activeTaskId ? " · current" : ""}
                </summary>
                <p className="muted">{task.headingPath.join(" / ")}</p>
                <p className="prose">{task.body}</p>
                <p className="hint mono">{task.taskId}</p>
              </details>
            ))}
          </section>
        ) : null}
        <section aria-label="Attention records">
          <h2 className="h3">Attention records</h2>
          <p className="hint">
            Historical notices stay here after a decision. The current status tells you whether the
            run needs attention now.
          </p>
          {status.attention.length ? (
            <pre className="raw">{JSON.stringify(redact(status.attention), null, 2)}</pre>
          ) : (
            <p className="muted">No attention records.</p>
          )}
        </section>
      </details>

      <nav className="tabs" aria-label="Run views">
        <a
          href={runHref(runId)}
          className={tab === "details" ? "current" : ""}
          aria-current={tab === "details" ? "page" : undefined}
        >
          History
        </a>
        <a
          href={runHref(runId, "map")}
          className={tab === "map" ? "current" : ""}
          aria-current={tab === "map" ? "page" : undefined}
        >
          Map
        </a>
      </nav>

      {data.historyError ? (
        <p className="inline-alert" role="alert">
          {data.historyError} Showing the history read so far.{" "}
          <button type="button" className="link" onClick={data.refresh}>
            Try loading history again
          </button>
        </p>
      ) : null}

      {tab === "map" ? (
        <RunMap
          graph={data.graph}
          graphError={data.graphError}
          run={{ status, items, onShowInHistory: showInHistory }}
          caption={`Read-only. Revision ${status.run.revisionId}.`}
        />
      ) : status.run.status === "ready" && items.every((i) => i.type === "note") ? (
        <ReadyPlan data={data} />
      ) : (
        <div className="split">
          <History
            items={items}
            tasks={status.tasks}
            selected={selected?.id ?? null}
            onSelect={setPicked}
            caughtUp={data.caughtUp}
          />
          <StepDetail
            item={selected}
            tasks={status.tasks}
            graph={data.graph}
            currentRevisionId={status.run.revisionId}
          />
        </div>
      )}
    </Shell>
  );
}
