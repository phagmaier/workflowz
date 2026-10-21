import { useEffect, useState } from "react";
import { describeReadFailure } from "../api.ts";
import { useConnection } from "../connection.tsx";
import type { SavedWorkflow } from "../types.ts";
import { Shell } from "./Shell.tsx";

/** Saved revisions, read-only until the editor slice; authoring stays in the classic interface. */
export function WorkflowsPage() {
  const { read } = useConnection();
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

  // Newest saves first.
  const rows = saved ? [...saved].sort((a, b) => b.revisionId - a.revisionId) : null;
  return (
    <Shell
      section="workflows"
      crumbs={[{ label: "Workflows" }]}
      pageKey="workflows"
      actions={
        <a className="btn btn-primary" href="/ui/">
          Create or edit in the classic interface
        </a>
      }
    >
      <h1 tabIndex={-1}>Workflows</h1>
      <p className="lede">
        A workflow is a saved list of steps. Every save is kept as a numbered revision, and each run
        uses exactly one revision. Editing and creating runs move into this interface in the next
        update; for now they open the classic interface.
      </p>
      {rows === null ? (
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
      ) : rows.length === 0 ? (
        <div className="state-panel">
          <h2>No saved workflows yet</h2>
          <p>
            Create one in the <a href="/ui/">classic interface</a>, or save a YAML file with{" "}
            <code>wf workflow import FILE</code>.
          </p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Revision</th>
              <th scope="col">Folder</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.revisionId}>
                <td data-label="Name" className="strong">
                  {row.name}
                </td>
                <td data-label="Revision">
                  {row.revisionId}{" "}
                  <span className="muted mono small">{row.sha256.slice(0, 10)}</span>
                </td>
                <td data-label="Folder" className="mono small">
                  {row.sourceDir}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}
