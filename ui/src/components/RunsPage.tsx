import { useEffect, useLayoutEffect, useRef } from "react";
import { ago, humanize, plural, sentence } from "../lib/format.ts";
import { needsAttention, RUN_GROUPS, type RunGroupId } from "../lib/run-copy.ts";
import { runHref, runsHref } from "../route.ts";
import { useRuns } from "../runs-data.tsx";
import type { RunRow } from "../types.ts";
import { Shell } from "./Shell.tsx";
import { StatusChip } from "./ui.tsx";

function note(run: RunRow): string {
  switch (run.status) {
    case "draft":
    case "ready":
      return "Not started";
    case "paused":
      return "Waiting for you";
    case "interrupted":
      return "Needs a recovery decision";
    case "running":
      return run.retryNotBefore && Date.parse(run.retryNotBefore) > Date.now()
        ? `Retry after ${new Date(run.retryNotBefore).toLocaleTimeString()}`
        : "In progress";
    case "pausing":
      return "Finishing the current step";
    default:
      return run.endTime ? `Ended ${ago(run.endTime)}` : "";
  }
}

export function RunsPage({ group }: { group: RunGroupId | null }) {
  const { runs, names, error, refresh } = useRuns();
  const content = useRef<HTMLDivElement>(null);
  const focused = useRef<string | null>(null);
  const focusedLink = useRef<HTMLAnchorElement | null>(null);
  const loaded = runs !== null;
  const deferredFocus = useRef(!loaded);
  // Arriving here shows the current list, not the last background poll.
  useEffect(refresh, [refresh]);
  useEffect(() => {
    if (!loaded) return;
    const deferred = deferredFocus.current;
    deferredFocus.current = false;
    const target = group ?? "all";
    const active = document.activeElement;
    // A late first read must not undo keyboard work done while the list was loading.
    const canFocus =
      !deferred ||
      !active ||
      active === document.body ||
      active.tagName === "H1" ||
      (active instanceof HTMLAnchorElement && active.getAttribute("href") === runsHref(group));
    // The default landing page keeps the browser's own initial focus.
    if (canFocus && focused.current !== target && (group !== null || focused.current !== null))
      content.current?.querySelector<HTMLElement>(group ? `#runs-${group}` : "h1")?.focus();
    focused.current = target;
  }, [group, loaded]);
  useLayoutEffect(() => {
    const previous = focusedLink.current;
    if (!previous || previous.isConnected || document.activeElement !== document.body) return;
    // A status change remounts a row in its new group. Keep the same logical link focused
    // without scrolling the page during a background refresh.
    const replacement = Array.from(
      content.current?.querySelectorAll<HTMLAnchorElement>("a[data-run-link]") ?? [],
    ).find(
      (link) =>
        link.getAttribute("href") === previous.getAttribute("href") &&
        link.dataset.runLink === previous.dataset.runLink,
    );
    focusedLink.current = replacement ?? null;
    replacement?.focus({ preventScroll: true });
  });
  const sorted = runs
    ? [...runs].sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt) || a.runId.localeCompare(b.runId),
      )
    : null;

  return (
    <Shell section="runs" crumbs={[{ label: "Runs" }]} pageKey="runs">
      <div
        ref={content}
        className="runs-page"
        onFocusCapture={(event) => {
          const target = event.target;
          focusedLink.current =
            target instanceof HTMLAnchorElement && target.hasAttribute("data-run-link")
              ? target
              : null;
        }}
        onBlurCapture={(event) => {
          if (event.target.isConnected) focusedLink.current = null;
        }}
      >
        <div className="page-head runs-page-head">
          <div>
            <h1 tabIndex={-1}>Runs</h1>
            <p className="lede">See what needs you, what’s ready and what happened.</p>
          </div>
          <div className="runs-page-actions">
            <span className="muted small runs-total">
              {sorted ? `${plural(sorted.length, "run")} · newest first in each group` : ""}
            </span>
            <button type="button" className="btn btn-sm" onClick={refresh}>
              {error ? "Try again now" : "Refresh runs"}
            </button>
          </div>
        </div>

        {error ? (
          <div className="state-panel runs-read-error" role="alert">
            <h2>{sorted === null ? "Runs couldn't be loaded" : "Runs couldn't be refreshed"}</h2>
            <p>
              {sentence(error)}
              {sorted !== null ? " The list and counts below may be out of date." : ""}
            </p>
          </div>
        ) : sorted === null ? (
          <p className="state-panel muted" role="status">
            <span className="spinner" aria-hidden="true" /> Loading runs…
          </p>
        ) : sorted.length === 0 ? (
          <div className="state-panel runs-empty">
            <h2>No runs yet</h2>
            <p>
              A run is prepared from a saved workflow and waits until you choose Start. Open a
              workflow and choose Create run, or use <code>wf run create</code> in a terminal. New
              runs appear here automatically.
            </p>
            <a className="btn" href="#/workflows">
              Open Workflows
            </a>
          </div>
        ) : null}

        {sorted ? (
          <div className="run-groups">
            {RUN_GROUPS.map((item) => {
              const rows = sorted.filter((run) => item.statuses.includes(run.status));
              return (
                <section
                  key={item.id}
                  className={`run-group run-group-${item.id}`}
                  aria-labelledby={`runs-${item.id}`}
                >
                  <div className="run-group-head">
                    <h2 id={`runs-${item.id}`} tabIndex={-1}>
                      <span
                        className={`run-group-dot run-group-dot-${item.id}`}
                        aria-hidden="true"
                      />
                      {item.label}
                      <span className="run-group-count">{rows.length}</span>
                    </h2>
                    <p>{item.description}</p>
                  </div>
                  {rows.length === 0 ? (
                    <p className="run-group-empty">{item.empty}</p>
                  ) : (
                    <div className="table-wrap">
                      <table className="table runs-table" aria-labelledby={`runs-${item.id}`}>
                        <thead>
                          <tr>
                            <th scope="col">Workflow</th>
                            <th scope="col">Status</th>
                            <th scope="col">Now at</th>
                            <th scope="col">Created</th>
                            <th scope="col">
                              <span className="sr-only">Open run</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((run) => (
                            <tr
                              key={run.runId}
                              className={needsAttention(run.status) ? "row-attention" : ""}
                            >
                              <td data-label="Workflow">
                                <a
                                  className="strong row-title"
                                  href={runHref(run.runId)}
                                  data-run-link="title"
                                >
                                  {names.get(run.revisionId) ?? `Revision ${run.revisionId}`}
                                </a>
                                <div className="muted small mono run-identity">
                                  {run.runId} · revision {run.revisionId}
                                </div>
                              </td>
                              <td data-label="Status">
                                <StatusChip status={run.status} />
                                <div className="muted small">{note(run)}</div>
                              </td>
                              <td data-label="Now at">
                                {run.status === "completed"
                                  ? "Finished"
                                  : humanize(run.cursorStepId)}
                              </td>
                              <td data-label="Created">
                                <time
                                  dateTime={run.createdAt}
                                  title={new Date(run.createdAt).toLocaleString()}
                                >
                                  {ago(run.createdAt)}
                                </time>
                              </td>
                              <td className="run-open-cell">
                                <a
                                  className="btn btn-sm run-open"
                                  href={runHref(run.runId)}
                                  data-run-link="open"
                                  aria-label={`Open run ${run.runId}`}
                                >
                                  Open <span aria-hidden="true">→</span>
                                </a>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        ) : null}
      </div>
    </Shell>
  );
}
