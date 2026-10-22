import { useEffect, useState } from "react";
import { describeReadFailure } from "../api.ts";
import { useConnection } from "../connection.tsx";
import { unsavedDrafts, useSessionRegistry } from "../editor-session.ts";
import { ago, plural } from "../lib/format.ts";
import { EXAMPLES, groupWorkflows } from "../lib/workflow-edit.ts";
import { editorHref, runHref } from "../route.ts";
import { useRuns } from "../runs-data.tsx";
import type { RunRow, SavedWorkflow } from "../types.ts";
import { ImportPanel } from "./ImportPanel.tsx";
import { Shell } from "./Shell.tsx";
import { StatusChip } from "./ui.tsx";

function Examples() {
  return (
    <section aria-labelledby="examples-title">
      <h2 id="examples-title" className="section-title">
        Start from an example
      </h2>
      <ul className="cards">
        {EXAMPLES.map((example) => (
          <li key={example.id}>
            <a className="card" href={`#/workflows/new/${example.id}`}>
              <strong>{example.name}</strong>
              <span className="muted">{example.text}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Drafts() {
  const drafts = unsavedDrafts();
  if (!drafts.length) return null;
  return (
    <section className="pane drafts" aria-labelledby="drafts-title">
      <h2 id="drafts-title">Unsaved drafts in this tab</h2>
      <ul className="plain">
        {drafts.map((session) => {
          const s = session.state;
          const href = session.key.startsWith("draft:")
            ? editorHref({ kind: "draft", key: session.key })
            : editorHref({ kind: "revision", revisionId: Number(session.key.slice(4)) });
          return (
            <li key={s.uid}>
              <a href={href} className="strong">
                {s.model?.name || "Untitled workflow"}
              </a>{" "}
              <span className="muted">
                {s.basedOn ? `· changes to revision ${s.basedOn}` : "· new, never saved"}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="hint">Drafts stay while this tab is open. Save to keep them.</p>
    </section>
  );
}

/** The newest run of any revision in the group. */
function latestRun(runs: readonly RunRow[], revisions: readonly SavedWorkflow[]) {
  const ids = new Set(revisions.map((r) => r.revisionId));
  return runs
    .filter((run) => ids.has(run.revisionId))
    .reduce<RunRow | null>(
      (newest, run) => (!newest || run.createdAt > newest.createdAt ? run : newest),
      null,
    );
}

export function WorkflowsPage({ importing = false }: { importing?: boolean }) {
  const { read } = useConnection();
  const { runs } = useRuns();
  useSessionRegistry();
  const [saved, setSaved] = useState<SavedWorkflow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs the read on request.
  useEffect(() => {
    let alive = true;
    read<SavedWorkflow[]>({ op: "workflows" }).then(
      (list) => {
        if (!alive) return;
        setSaved(list);
        setError(null);
      },
      (failure: unknown) => alive && setError(describeReadFailure(failure)),
    );
    return () => {
      alive = false;
    };
  }, [read, attempt]);

  const perRevision = new Map<number, number>();
  for (const run of runs ?? [])
    perRevision.set(run.revisionId, (perRevision.get(run.revisionId) ?? 0) + 1);
  const groups = saved ? groupWorkflows(saved, perRevision) : null;

  return (
    <Shell
      section="workflows"
      crumbs={
        importing
          ? [{ label: "Workflows", href: "#/workflows" }, { label: "Import file" }]
          : [{ label: "Workflows" }]
      }
      pageKey={importing ? "import-workflow" : "workflows"}
    >
      <div className="page-head">
        <h1 tabIndex={-1}>Workflows</h1>
        <p className="lede">
          Saved workflows. Open one to check it, edit it or create a run. Every save is kept as a
          numbered revision.
        </p>
      </div>
      <Drafts />
      {groups === null ? (
        error ? (
          <div className="state-panel" role="alert">
            <p>{error}</p>
            <button type="button" className="btn" onClick={() => setAttempt(attempt + 1)}>
              Try again now
            </button>
          </div>
        ) : (
          <p className="muted" role="status">
            <span className="spinner" aria-hidden="true" /> Loading workflows…
          </p>
        )
      ) : groups.length === 0 ? (
        <div className="state-panel">
          <h2>No saved workflows yet</h2>
          <p>Use New workflow in the sidebar, import a file below, or start from an example.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table workflows-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Saved</th>
                <th scope="col">Latest run</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const run = runs ? latestRun(runs, [group.latest, ...group.older]) : null;
                return (
                  <tr key={group.name}>
                    <td data-label="Name">
                      <a
                        className="strong row-title"
                        href={editorHref({ kind: "revision", revisionId: group.latest.revisionId })}
                      >
                        {group.name}
                      </a>
                      <span className="mono small muted">{group.latest.sourceDir}</span>
                    </td>
                    <td data-label="Saved">
                      Revision {group.latest.revisionId}
                      {group.older.length ? (
                        <details className="older">
                          <summary className="muted">
                            {plural(group.older.length, "earlier revision")}
                          </summary>
                          <ul className="plain">
                            {group.older.map((r) => (
                              <li key={r.revisionId}>
                                <a
                                  href={editorHref({ kind: "revision", revisionId: r.revisionId })}
                                >
                                  Revision {r.revisionId}
                                </a>
                                {r.sourceDir !== group.latest.sourceDir ? (
                                  <span className="muted mono small"> {r.sourceDir}</span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </td>
                    <td data-label="Latest run">
                      {run ? (
                        <a className="run-link" href={runHref(run.runId)}>
                          <StatusChip status={run.status} />
                          <span className="muted small">
                            created {ago(run.createdAt)}
                            {` · ${plural(group.runs, "run")}`}
                          </span>
                        </a>
                      ) : (
                        <span className="muted">No runs yet</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ImportPanel focused={importing} />
      {groups?.length === 0 ? <Examples /> : null}
    </Shell>
  );
}
