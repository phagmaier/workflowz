import { useMemo, useState } from "react";
import { clock, duration, humanize, KIND_LABEL } from "../lib/format.ts";
import { buildHistory, type HistoryItem } from "../lib/history.ts";
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

      {tab === "map" ? (
        <RunMap
          graph={data.graph}
          graphError={data.graphError}
          status={status}
          items={items}
          onShowInHistory={showInHistory}
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
          <StepDetail item={selected} tasks={status.tasks} graph={data.graph} />
        </div>
      )}
    </Shell>
  );
}
