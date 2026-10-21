import { type KeyboardEvent, useState } from "react";
import {
  between,
  clock,
  duration,
  harnessLabel,
  humanize,
  isSystemOutcome,
  KIND_LABEL,
  outcomeLabel,
} from "../lib/format.ts";
import { groupHistory, type HistoryItem, redact, type StepItem } from "../lib/history.ts";
import type { RunGraph } from "../run-data.ts";
import type { TaskRow } from "../types.ts";

const WARN = /^(blocked|failed|revise|needs_|error|reject)/;

function ResultChip({ item }: { item: HistoryItem }) {
  if (item.type === "note")
    return item.kind === "manual" || item.kind === "revised" ? (
      <span className="chip chip-attention">your action</span>
    ) : null;
  if (item.state === "running")
    return (
      <span className="chip chip-active">
        <span className="spinner" aria-hidden="true" />
        running
      </span>
    );
  if (item.state === "interrupted") return <span className="chip chip-danger">interrupted</span>;
  if (item.state === "stopped") return <span className="chip chip-neutral">stopped</span>;
  if (!item.outcome) return null;
  const tone = isSystemOutcome(item.outcome)
    ? "res-bad"
    : WARN.test(item.outcome)
      ? "res-warn"
      : "res-ok";
  return (
    <code className={`res ${tone}`} title={item.byYou ? "Result set by you" : undefined}>
      {outcomeLabel(item.outcome)}
      {item.byYou ? " · set by you" : item.state === "skipped" ? " · skipped" : ""}
    </code>
  );
}

function destination(item: StepItem): string {
  if (item.decision === "pause") return "→ paused";
  if (item.decision === "retry") return "↻ retry";
  if (item.decision === "goto" && item.to) return `→ ${humanize(item.to)}`;
  return "";
}

const itemDuration = (item: HistoryItem, now: number) =>
  item.type === "step" && item.attemptId
    ? duration(between(item.at, item.endedAt ?? new Date(now).toISOString()))
    : "";

export function History({
  items,
  tasks,
  selected,
  onSelect,
  caughtUp,
}: {
  items: readonly HistoryItem[];
  tasks: readonly TaskRow[];
  selected: string | null;
  onSelect: (id: string) => void;
  caughtUp: boolean;
}) {
  const groups = groupHistory(items);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const now = Date.now();
  const steps = items.filter((item) => item.type === "step").length;

  const keys = (event: KeyboardEvent<HTMLOListElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button.hist")];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next = buttons[index + (event.key === "ArrowDown" ? 1 : -1)];
    next?.focus();
    next?.click();
  };

  return (
    <section className="pane history-pane" aria-labelledby="history-title">
      <div className="pane-head">
        <h2 id="history-title">What happened</h2>
        <span className="muted">
          {steps} step{steps === 1 ? "" : "s"}
          {caughtUp ? "" : " · loading more…"}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="muted">Nothing has happened yet.</p>
      ) : (
        <ol className="history" onKeyDown={keys}>
          {groups.map((group, index) => {
            const task = group.taskId ? tasks.find((t) => t.taskId === group.taskId) : undefined;
            const done = task?.state === "completed";
            const last = index === groups.length - 1;
            const isOpen =
              open[group.key] ?? (last || !done || group.items.some((i) => i.id === selected));
            const position = task ? tasks.indexOf(task) + 1 : null;
            return (
              <li key={group.key} className="group">
                <button
                  type="button"
                  className="group-head"
                  aria-expanded={isOpen}
                  onClick={() => setOpen({ ...open, [group.key]: !isOpen })}
                >
                  <span className="caret" aria-hidden="true">
                    {isOpen ? "▾" : "▸"}
                  </span>
                  <span className="group-title">
                    {task ? `Task ${position}: ${task.title}` : group.taskId ? "Task" : "Run"}
                  </span>
                  <span className="muted small">
                    {done ? "✓ done · " : ""}
                    {group.items.length} item{group.items.length === 1 ? "" : "s"}
                  </span>
                </button>
                {isOpen ? (
                  <ol className="items">
                    {group.items.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={`hist ${item.type === "note" ? "hist-note" : ""} ${selected === item.id ? "current" : ""}`}
                          aria-current={selected === item.id ? "true" : undefined}
                          onClick={() => onSelect(item.id)}
                        >
                          <span className="t mono">{clock(item.at)}</span>
                          <span className="n">
                            {item.type === "step" ? humanize(item.stepId) : item.text}
                          </span>
                          <ResultChip item={item} />
                          <span className="muted dest">
                            {item.type === "step" ? destination(item) : ""}
                          </span>
                          <span className="muted d">{itemDuration(item, now)}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function thenText(item: StepItem): string {
  if (item.decision === "goto" && item.to) return `Went to ${humanize(item.to)}`;
  if (item.decision === "retry") return "Tried this step again";
  if (item.decision === "pause")
    return item.pauseReason === "retry_exhausted"
      ? "Paused — retries were used up"
      : item.pauseReason === "retry_unsupported_for_engine_step"
        ? "Paused — this kind of step can't retry"
        : `Paused — the workflow pauses on “${item.outcome}”`;
  return "";
}

function RawEvents({ item }: { item: HistoryItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="disclosure">
      <button
        type="button"
        className="disclosure-btn"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span> Technical details{" "}
        <span className="muted">
          — {item.events.length} event{item.events.length === 1 ? "" : "s"}
        </span>
      </button>
      {open ? (
        <pre className="raw">
          {JSON.stringify(
            item.events.map((event) => ({ ...event, data: redact(event.data) })),
            null,
            2,
          )}
        </pre>
      ) : null}
    </div>
  );
}

export function StepDetail({
  item,
  tasks,
  graph,
}: {
  item: HistoryItem | undefined;
  tasks: readonly TaskRow[];
  graph: RunGraph | null;
}) {
  if (!item)
    return (
      <section className="pane detail-pane" aria-label="Step details">
        <p className="muted">Select an item in the history to see its result.</p>
      </section>
    );
  const task = item.taskId ? tasks.find((t) => t.taskId === item.taskId) : undefined;
  const context = [
    task ? `Task ${tasks.indexOf(task) + 1}` : "Run",
    clock(item.at),
    itemDuration(item, Date.now()),
  ]
    .filter(Boolean)
    .join(" · ");

  if (item.type === "note")
    return (
      <section className="pane detail-pane" aria-labelledby="detail-title">
        <div className="kind-label">{context}</div>
        <h2 id="detail-title">{item.text}</h2>
        {item.reason ? (
          <p>
            Reason: <q>{item.reason}</q>
          </p>
        ) : null}
        {item.kind === "manual" ? (
          <p className="muted">Recorded in the run's history. The run stayed paused.</p>
        ) : null}
        <RawEvents item={item} />
      </section>
    );

  const spec = graph?.specs[item.stepId];
  const who =
    spec?.kind === "agent"
      ? `${harnessLabel(spec.harness)}${spec.model ? ` · ${spec.model}` : " · default model"}`
      : spec?.kind === "command"
        ? `$ ${spec.argv.join(" ")}`
        : (KIND_LABEL[spec?.kind ?? ""] ?? "");
  const manual = item.byYou
    ? item.events.find((event) => event.type === "manual_override")?.data.reason
    : undefined;
  const report = item.report;
  return (
    <section className="pane detail-pane" aria-labelledby="detail-title">
      <div className="kind-label">{context}</div>
      <h2 id="detail-title">{humanize(item.stepId)}</h2>
      {who ? <div className="muted mono who">{who}</div> : null}
      {task ? <p className="muted small">{task.title}</p> : null}
      {item.state === "running" ? (
        <div className="callout">
          <span className="spinner" aria-hidden="true" /> Running. The result appears here when it
          finishes.
        </div>
      ) : item.state === "interrupted" ? (
        <div className="callout callout-danger">
          No result. The daemon stopped while this step ran. Whether it changed files is unknown;
          check the project before deciding what to do.
        </div>
      ) : item.state === "stopped" ? (
        <div className="callout">
          Stopped before it finished. The process was ended and cleaned up; file changes were kept.
        </div>
      ) : null}
      {item.outcome || item.state === "done" || item.state === "skipped" ? (
        <dl className="kv">
          {item.outcome ? (
            <>
              <dt>Result</dt>
              <dd>
                <code>{item.outcome}</code>
                {isSystemOutcome(item.outcome) ? ` — ${outcomeLabel(item.outcome)}` : ""}
                {item.byYou
                  ? " — set by you"
                  : item.state === "skipped"
                    ? " — step skipped by its task settings"
                    : ""}
              </dd>
            </>
          ) : null}
          {typeof manual === "string" ? (
            <>
              <dt>Your reason</dt>
              <dd>{manual}</dd>
            </>
          ) : null}
          {report ? (
            <>
              <dt>Summary</dt>
              <dd className="prose">{report.summary}</dd>
              {report.issue ? (
                <>
                  <dt>Issue</dt>
                  <dd className="prose">{report.issue}</dd>
                </>
              ) : null}
              {report.handoff ? (
                <>
                  <dt>Handoff</dt>
                  <dd className="prose">{report.handoff}</dd>
                </>
              ) : null}
            </>
          ) : null}
          {item.exitCode !== null && spec?.kind === "command" ? (
            <>
              <dt>Exit code</dt>
              <dd>{item.exitCode}</dd>
            </>
          ) : null}
          {item.timedOut ? (
            <>
              <dt>Time limit</dt>
              <dd>Stopped because it ran too long</dd>
            </>
          ) : null}
          {item.failureDetail ? (
            <>
              <dt>Failure</dt>
              <dd className="prose">{item.failureDetail}</dd>
            </>
          ) : null}
          {item.stderr ? (
            <>
              <dt>Error output</dt>
              <dd>
                <pre className="out">{item.stderr}</pre>
              </dd>
            </>
          ) : null}
          {thenText(item) ? (
            <>
              <dt>Then</dt>
              <dd>{thenText(item)}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {spec && (spec.kind === "agent" || spec.kind === "command") ? (
        <details className="disclosure">
          <summary>Step definition</summary>
          {spec.kind === "agent" ? (
            <pre className="out">{spec.prompt ?? `Prompt file: ${spec.prompt_file}`}</pre>
          ) : (
            <pre className="out">{spec.argv.join(" ")}</pre>
          )}
        </details>
      ) : null}
      <RawEvents item={item} />
    </section>
  );
}
