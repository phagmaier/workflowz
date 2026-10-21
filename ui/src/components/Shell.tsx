import { type ReactNode, useEffect, useRef, useState } from "react";
import { describeFailure } from "../api.ts";
import { useConnection } from "../connection.tsx";
import { needsAttention } from "../lib/run-copy.ts";
import { useRuns } from "../runs-data.tsx";
import { Feedback, type FeedbackState } from "./ui.tsx";

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

/** Persistent frame: sidebar navigation, breadcrumbs with page actions, connection banners. */
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
  const { runs } = useRuns();
  const attention = runs?.filter((run) => needsAttention(run.status)).length ?? 0;
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
        <a className="brand" href="#/runs">
          Workflowz
        </a>
        <a
          href="#/workflows"
          className={`navlink ${section === "workflows" ? "current" : ""}`}
          aria-current={section === "workflows" ? "page" : undefined}
        >
          Workflows
        </a>
        <a
          href="#/runs"
          className={`navlink ${section === "runs" ? "current" : ""}`}
          aria-current={section === "runs" ? "page" : undefined}
        >
          Runs
          {attention ? (
            <span
              className="badge"
              title={`${attention} need${attention === 1 ? "s" : ""} attention`}
            >
              {attention}
              <span className="sr-only"> need{attention === 1 ? "s" : ""} attention</span>
            </span>
          ) : null}
        </a>
        <div className="side-foot">
          <p className="conn" role="status">
            <span className={`dot ${online ? "dot-ok" : "dot-bad"}`} aria-hidden="true" />
            {online ? "Daemon connected" : "Disconnected"}
            <small>{online ? "This browser is paired" : "Runs keep going in the daemon"}</small>
          </p>
          <a className="side-link" href="/ui/">
            Classic interface
          </a>
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
