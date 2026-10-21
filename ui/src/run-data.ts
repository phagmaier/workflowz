/** Polls one run politely: status every 2 s while it moves, 5 s otherwise; events by cursor. */
import { useCallback, useRef, useState } from "react";
import { describeReadFailure } from "./api.ts";
import { useConnection, usePolling } from "./connection.tsx";
import { harnessLabel, KIND_LABEL } from "./lib/format.ts";
import type { MapGraph } from "./lib/map-layout.ts";
import type {
  BrowserDraft,
  BrowserEvents,
  BrowserRunEdit,
  BrowserRunStatus,
  EventRow,
  ReportRow,
} from "./types.ts";

type WorkflowStep = NonNullable<BrowserDraft["document"]>["steps"][string];
export interface RunGraph extends MapGraph {
  name: string;
  specs: Readonly<Record<string, WorkflowStep>>;
}

/** Map input from a checked draft, or null while it doesn't compile (no resolved routes yet). */
export function graphOf(draft: BrowserDraft): RunGraph | null {
  if (!draft.document || draft.projectRoot === null) return null;
  const specs = draft.document.steps;
  return {
    name: draft.document.name,
    start: draft.document.start,
    steps: Object.entries(specs).map(([id, spec]) => ({
      id,
      kind: spec.kind,
      detail: stepDetail(spec),
    })),
    transitions: draft.transitions,
    specs,
  };
}

export interface RunData {
  status: BrowserRunStatus | null;
  error: string | null;
  events: readonly EventRow[];
  /** All history up to the cursor has been read. */
  caughtUp: boolean;
  historyError: string | null;
  reports: readonly ReportRow[];
  graph: RunGraph | null;
  graphError: string | null;
  /** Paused-run choices, pinned to the event they were read at. */
  runEdit: BrowserRunEdit | null;
  runEditError: string | null;
  updatedAt: number | null;
  refresh: () => void;
}

function stepDetail(step: WorkflowStep): string {
  if (step.kind === "agent")
    return `${harnessLabel(step.harness)}${step.model ? ` · ${step.model.split("/").pop()}` : ""}`;
  if (step.kind === "command") return `$ ${step.argv.join(" ")}`;
  return KIND_LABEL[step.kind] ?? step.kind;
}

export function useRunData(runId: string): RunData {
  const { read } = useConnection();
  const [status, setStatus] = useState<BrowserRunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<readonly EventRow[]>([]);
  const [caughtUp, setCaughtUp] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [reports, setReports] = useState<readonly ReportRow[]>([]);
  const [graph, setGraph] = useState<RunGraph | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [runEdit, setRunEdit] = useState<BrowserRunEdit | null>(null);
  const [runEditError, setRunEditError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const cache = useRef({
    cursor: 0,
    events: [] as EventRow[],
    reportsLoaded: false,
    revisionId: 0,
    runEditEvent: 0,
  });
  const moving = status?.run.status === "running" || status?.run.status === "pausing";

  const tick = useCallback(async () => {
    const memo = cache.current;
    let next: BrowserRunStatus;
    try {
      next = await read<BrowserRunStatus>({ op: "status", runId });
    } catch (failure) {
      setError(describeReadFailure(failure));
      throw failure;
    }
    setStatus(next);
    setError(null);
    setUpdatedAt(Date.now());
    // Never label a newer revision with the previous revision's step definitions, including
    // while other history reads are still waiting for their replies.
    if (memo.revisionId !== next.run.revisionId) setGraph(null);

    const historyFailures: string[] = [];
    try {
      for (let page = 0; page < 10; page++) {
        const result = await read<BrowserEvents>({
          op: "events",
          runId,
          after: memo.cursor,
          limit: 1000,
        });
        if (result.events.length) {
          memo.events = [...memo.events, ...result.events];
          memo.cursor = result.nextAfter;
          // Invalidate as the page is consumed: a later event-page failure must not lose this
          // acceptance after its cursor has advanced.
          if (result.events.some((event) => event.type === "report_accepted"))
            memo.reportsLoaded = false;
        }
        if (!result.hasMore) break;
      }
      setCaughtUp(memo.cursor >= next.expectedEventId);
    } catch (failure) {
      setCaughtUp(false);
      historyFailures.push(`History: ${describeReadFailure(failure)}`);
    }
    setEvents(memo.events);
    if (!memo.reportsLoaded) {
      try {
        setReports(await read<ReportRow[]>({ op: "reports", runId }));
        memo.reportsLoaded = true;
      } catch (failure) {
        historyFailures.push(`Reports: ${describeReadFailure(failure)}`);
      }
    }
    setHistoryError(historyFailures.length ? historyFailures.join(" ") : null);

    if (memo.revisionId !== next.run.revisionId) {
      try {
        const source = await read<{ name: string; workflowText: string; workflowDir: string }>({
          op: "load",
          source: { revisionId: next.run.revisionId },
        });
        const draft = await read<BrowserDraft>({
          op: "draft",
          workflowText: source.workflowText,
          workflowDir: source.workflowDir,
        });
        const built = graphOf(draft);
        if (!built) throw new Error("the saved definition could not be read");
        setGraph({ ...built, name: source.name });
        memo.revisionId = next.run.revisionId;
        setGraphError(null);
      } catch (failure) {
        setGraphError(describeReadFailure(failure));
      }
    }

    if (next.run.status !== "paused") {
      memo.runEditEvent = 0;
      setRunEdit(null);
      setRunEditError(null);
    } else if (memo.runEditEvent !== next.expectedEventId) {
      try {
        const edit = await read<BrowserRunEdit>({
          op: "run-edit",
          runId,
          expectedEventId: next.expectedEventId,
        });
        memo.runEditEvent = next.expectedEventId;
        setRunEdit(edit);
        setRunEditError(null);
      } catch (failure) {
        setRunEdit(null);
        setRunEditError(describeReadFailure(failure));
      }
    }
  }, [read, runId]);

  const refresh = usePolling(tick, moving ? 2000 : 5000);
  return {
    status,
    error,
    events,
    caughtUp,
    historyError,
    reports,
    graph,
    graphError,
    runEdit,
    runEditError,
    updatedAt,
    refresh,
  };
}
