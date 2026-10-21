import { useEffect, useState } from "react";
import { describeReadFailure } from "../api.ts";
import { useConnection } from "../connection.tsx";
import { unsavedDrafts, useSessionRegistry } from "../editor-session.ts";
import { plural } from "../lib/format.ts";
import { EXAMPLES, groupWorkflows } from "../lib/workflow-edit.ts";
import { editorHref } from "../route.ts";
import { useRuns } from "../runs-data.tsx";
import type { SavedWorkflow } from "../types.ts";
import { Shell } from "./Shell.tsx";

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

export function WorkflowsPage() {
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
  const drafts = unsavedDrafts();

  return (
    <Shell
      section="workflows"
      crumbs={[{ label: "Workflows" }]}
      pageKey="workflows"
      actions={
        <a className="btn btn-primary" href="#/workflows/new">
          ＋ Create workflow
        </a>
      }
    >
      <h1 tabIndex={-1}>Workflows</h1>
      <p className="lede">
        A workflow is a list of steps and what happens after each result. Every save is kept as a
        numbered revision; open one to edit it or to create a run from it.
      </p>
      {drafts.length ? (
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
      ) : null}
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
          <p>
            Choose <a href="#/workflows/new">Create workflow</a> or start from an example below.
          </p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Latest save</th>
              <th scope="col">Workflow folder</th>
              <th scope="col">Runs</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.name}>
                <td data-label="Name">
                  <a
                    className="strong"
                    href={editorHref({ kind: "revision", revisionId: group.latest.revisionId })}
                  >
                    {group.name}
                  </a>
                </td>
                <td data-label="Latest save">
                  Revision {group.latest.revisionId}
                  {group.older.length ? (
                    <details className="older">
                      <summary className="muted">
                        {plural(group.older.length, "earlier revision")}
                      </summary>
                      <ul className="plain">
                        {group.older.map((r) => (
                          <li key={r.revisionId}>
                            <a href={editorHref({ kind: "revision", revisionId: r.revisionId })}>
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
                <td data-label="Workflow folder" className="mono small">
                  {group.latest.sourceDir}
                </td>
                <td data-label="Runs">
                  {group.runs ? (
                    <a href="#/runs">{plural(group.runs, "run")}</a>
                  ) : (
                    <span className="muted">None</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Examples />
    </Shell>
  );
}
