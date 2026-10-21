import { useEffect } from "react";
import { ago, humanize } from "../lib/format.ts";
import { needsAttention } from "../lib/run-copy.ts";
import { runHref } from "../route.ts";
import { useRuns } from "../runs-data.tsx";
import type { RunRow } from "../types.ts";
import { Shell } from "./Shell.tsx";
import { StatusChip, useDraft } from "./ui.tsx";

const FILTERS = {
  all: { label: "All", test: () => true },
  attention: { label: "Needs attention", test: (run: RunRow) => needsAttention(run.status) },
  active: {
    label: "Ready & running",
    test: (run: RunRow) => ["ready", "running", "pausing"].includes(run.status),
  },
  done: {
    label: "Finished",
    test: (run: RunRow) => run.status === "completed" || run.status === "stopped",
  },
} as const;
type Filter = keyof typeof FILTERS;

function note(run: RunRow): string {
  switch (run.status) {
    case "ready":
      return "Not started";
    case "paused":
      return "Waiting for you";
    case "interrupted":
      return "Needs a recovery decision";
    case "running":
    case "pausing":
      return `At ${humanize(run.cursorStepId)}`;
    default:
      return run.endTime ? `Ended ${ago(run.endTime)}` : "";
  }
}

export function RunsPage() {
  const { runs, names, error, refresh } = useRuns();
  const [filterValue, setFilter] = useDraft("runs:filter", "all");
  // Arriving here shows the current list, not the last background poll.
  useEffect(refresh, [refresh]);
  const filter: Filter = filterValue in FILTERS ? (filterValue as Filter) : "all";
  const sorted = runs ? [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : null;
  const shown = sorted?.filter(FILTERS[filter].test) ?? null;

  return (
    <Shell section="runs" crumbs={[{ label: "Runs" }]} pageKey="runs">
      <h1 tabIndex={-1}>Runs</h1>
      <p className="lede">
        Each run is one execution of a saved workflow. Open a run to start it, follow it or decide
        what happens next.
      </p>
      {sorted && sorted.length > 0 ? (
        <fieldset className="seg" aria-label="Show runs">
          {(Object.keys(FILTERS) as Filter[]).map((key) => {
            const count = sorted.filter(FILTERS[key].test).length;
            return (
              <button
                key={key}
                type="button"
                className={`seg-btn ${filter === key ? "current" : ""}`}
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
              >
                {FILTERS[key].label} <span className="count">{count}</span>
              </button>
            );
          })}
        </fieldset>
      ) : null}

      {shown === null ? (
        error ? (
          <div className="state-panel" role="alert">
            <h2>Runs couldn't be loaded</h2>
            <p>{error}</p>
            <button type="button" className="btn" onClick={refresh}>
              Try again now
            </button>
          </div>
        ) : (
          <p className="state-panel muted" role="status">
            <span className="spinner" aria-hidden="true" /> Loading runs…
          </p>
        )
      ) : sorted?.length === 0 ? (
        <div className="state-panel">
          <h2>No runs yet</h2>
          <p>
            A run is prepared from a workflow and waits until you press Start. Open a workflow on
            the <a href="#/workflows">Workflows</a> page and choose Create run, or use{" "}
            <code>wf run create</code> in a terminal. New runs appear here automatically.
          </p>
        </div>
      ) : (
        <>
          {error ? (
            <p className="inline-alert" role="alert">
              {error} The list below may be out of date.
            </p>
          ) : null}
          <table className="table runs-table">
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Workflow</th>
                <th scope="col">Now at</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    No runs match “{FILTERS[filter].label}”.
                  </td>
                </tr>
              ) : (
                shown.map((run) => (
                  <tr key={run.runId} className={needsAttention(run.status) ? "row-attention" : ""}>
                    <td data-label="Status">
                      <StatusChip status={run.status} />
                      <div className="muted small">{note(run)}</div>
                    </td>
                    <td data-label="Workflow">
                      <a className="strong" href={runHref(run.runId)}>
                        {names.get(run.revisionId) ?? `Revision ${run.revisionId}`}
                      </a>
                      <div className="muted small mono">
                        {run.runId} · revision {run.revisionId}
                      </div>
                    </td>
                    <td data-label="Now at">
                      {run.status === "completed" ? "Finished" : humanize(run.cursorStepId)}
                    </td>
                    <td data-label="Created">
                      <time
                        dateTime={run.createdAt}
                        title={new Date(run.createdAt).toLocaleString()}
                      >
                        {ago(run.createdAt)}
                      </time>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </>
      )}
    </Shell>
  );
}
