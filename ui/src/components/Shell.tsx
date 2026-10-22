import { type ReactNode, useEffect, useRef, useState } from "react";
import { describeFailure } from "../api.ts";
import { useConnection } from "../connection.tsx";
import { unsavedDrafts, useSessionRegistry } from "../editor-session.ts";
import { RUN_GROUPS } from "../lib/run-copy.ts";
import { groupWorkflows } from "../lib/workflow-edit.ts";
import { editorHref, useRoute } from "../route.ts";
import { useRuns } from "../runs-data.tsx";
import { PlusIcon } from "./icons.tsx";
import { Feedback, type FeedbackState } from "./ui.tsx";

const SIDEBAR_WORKFLOWS = 8;

// The location whose heading should receive focus once its content (not a placeholder) renders.
const focus: { shown: string | null; pending: string | null } = { shown: null, pending: null };
function moveFocus(pageKey: string, main: HTMLElement | null) {
  if (focus.shown !== pageKey) {
    // The first page of a load keeps the browser's own focus.
    if (focus.shown !== null) focus.pending = pageKey;
    focus.shown = pageKey;
  }
  if (focus.pending !== pageKey || !main) return;
  const heading = main.querySelector<HTMLElement>("h1");
  const active = document.activeElement;
  if (!heading || (active && active !== document.body && active.tagName !== "H1")) return;
  heading.focus();
  if (!heading.hasAttribute("data-placeholder")) focus.pending = null;
}

export interface Crumb {
  label: string;
  href?: string;
}

/** Persistent frame: sidebar with workflows and run groups, breadcrumbs, connection banners. */
export function Shell({
  section,
  crumbs,
  actions,
  pageKey,
  children,
}: {
  section: "runs" | "workflows" | null;
  crumbs: readonly Crumb[];
  actions?: ReactNode;
  /** Changes when the location changes; moves focus to the new page heading. */
  pageKey: string;
  children: ReactNode;
}) {
  const { online, closing, driveFailure, busy, mutate, loggedOut } = useConnection();
  const { runs, saved, names } = useRuns();
  const route = useRoute();
  useSessionRegistry();
  const perRevision = new Map<number, number>();
  for (const run of runs ?? [])
    perRevision.set(run.revisionId, (perRevision.get(run.revisionId) ?? 0) + 1);
  const groups = saved ? groupWorkflows(saved, perRevision) : null;
  const openRevision =
    route.view === "editor" && route.target.kind === "revision" ? route.target.revisionId : null;
  const currentName = openRevision === null ? null : (names.get(openRevision) ?? null);
  const edited = new Set(
    unsavedDrafts().flatMap((session) => {
      const name = session.state.basedOn === null ? undefined : names.get(session.state.basedOn);
      return name === undefined ? [] : [name];
    }),
  );
  const [logout, setLogout] = useState<FeedbackState>(null);
  const main = useRef<HTMLElement>(null);

  const title = crumbs.at(-1)?.label ?? "Workflowz";
  useEffect(() => {
    document.title = `${title} — Workflowz`;
  }, [title]);
  // Focus follows navigation only, never polling updates (see moveFocus).
  useEffect(() => moveFocus(pageKey, main.current));

  const disconnect = async () => {
    setLogout({ kind: "pending", text: "Disconnecting…" });
    try {
      await mutate("logout", { op: "logout" });
      loggedOut();
    } catch (error) {
      setLogout({ kind: "error", text: describeFailure(error) });
    }
  };

  return (
    <div className="layout">
      <button
        type="button"
        className="skip"
        onClick={() => main.current?.querySelector<HTMLElement>("h1")?.focus()}
      >
        Skip to content
      </button>
      <nav className="side" aria-label="Main">
        <a className="brand" href="#/workflows">
          Workflowz
        </a>
        <div className="side-actions">
          <a className="btn btn-primary" href="#/workflows/new">
            <PlusIcon />
            New workflow
          </a>
          <a className="btn" href="#/workflows/import">
            Import file…
          </a>
        </div>
        <div className="side-group side-workflows">
          <a
            href="#/workflows"
            className={`side-head ${section === "workflows" ? "current" : ""}`}
            aria-current={section === "workflows" && !currentName ? "page" : undefined}
          >
            Workflows
            <span aria-hidden="true">All</span>
          </a>
          {groups?.length ? (
            <ul className="side-list">
              {groups.slice(0, SIDEBAR_WORKFLOWS).map((group) => (
                <li key={group.name}>
                  <a
                    className={`side-item ${group.name === currentName ? "current" : ""}`}
                    aria-current={group.name === currentName ? "page" : undefined}
                    href={editorHref({ kind: "revision", revisionId: group.latest.revisionId })}
                  >
                    <span className="side-name">{group.name}</span>
                    {edited.has(group.name) ? (
                      <span
                        className="dot dot-warn"
                        role="img"
                        aria-label="edited"
                        title="Unsaved changes in this tab"
                      />
                    ) : null}
                  </a>
                </li>
              ))}
            </ul>
          ) : groups ? (
            <p className="side-empty">No saved workflows yet</p>
          ) : null}
        </div>
        <div className="side-group">
          <a
            href="#/runs"
            className={`side-head ${section === "runs" ? "current" : ""}`}
            aria-current={section === "runs" ? "page" : undefined}
          >
            Runs
            <span aria-hidden="true">All</span>
          </a>
          <ul className="side-list">
            {RUN_GROUPS.map((group) => {
              const count = runs?.filter((run) => group.statuses.includes(run.status)).length;
              const waiting = group === RUN_GROUPS[0] && Boolean(count);
              return (
                <li key={group.label}>
                  <a className={`side-item ${waiting ? "waiting" : ""}`} href="#/runs">
                    <span className="side-name">{group.label}</span>
                    <span className={`side-count ${waiting ? "badge" : ""}`}>{count ?? "–"}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="side-foot">
          <p className="conn" role="status">
            <span className={`dot ${online ? "dot-ok" : "dot-bad"}`} aria-hidden="true" />
            {online ? "Daemon connected" : "Disconnected"}
            <small>{online ? "This browser is paired" : "Runs keep going in the daemon"}</small>
          </p>
          <button
            type="button"
            className="side-link"
            onClick={() => void disconnect()}
            disabled={busy !== null}
          >
            Disconnect this browser
          </button>
          <Feedback value={logout} />
        </div>
      </nav>
      <div className="main">
        {!online ? (
          <div className="banner banner-bad" role="alert">
            <strong>Lost connection to the daemon.</strong> Runs keep going there. Actions are
            disabled until this page reconnects; it tries again every few seconds.
          </div>
        ) : null}
        {closing ? (
          <div className="banner banner-warn" role="status">
            <strong>The daemon is shutting down.</strong> It finishes the current step, then stops.
            New actions are refused.
          </div>
        ) : null}
        {driveFailure ? (
          <div className="banner banner-bad" role="alert">
            <strong>A run stopped unexpectedly.</strong> {driveFailure}
          </div>
        ) : null}
        <header className="topbar">
          <nav aria-label="Breadcrumb">
            <ol className="crumbs">
              {crumbs.map((crumb, index) => (
                <li key={`${crumb.href ?? "here"}:${crumb.label}`}>
                  {crumb.href && index < crumbs.length - 1 ? (
                    <a href={crumb.href}>{crumb.label}</a>
                  ) : (
                    <span aria-current={index === crumbs.length - 1 ? "page" : undefined}>
                      {crumb.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
          {actions ? <div className="top-actions">{actions}</div> : null}
        </header>
        <main ref={main} className="page" id="main">
          {children}
        </main>
      </div>
    </div>
  );
}
