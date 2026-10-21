/** Display wording shared by the run screens. Identifiers stay visible where precision matters. */

export function humanize(id: string): string {
  if (!id) return "";
  const text = id.replaceAll("_", " ").replaceAll(".", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const HARNESS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  omp: "oh-my-pi",
  opencode: "OpenCode",
  pi: "Pi",
};
export const harnessLabel = (id: string) => HARNESS[id] ?? id;

export const KIND_LABEL: Record<string, string> = {
  agent: "Ask an agent",
  command: "Run a command",
  "task.next": "Pick the next task",
  "task.complete": "Mark task done",
  end: "Finish",
};

const SYSTEM_LABEL: Record<string, string> = {
  "system.error": "a technical failure",
  "system.spawn_error": "could not start",
  "system.process_error": "process failed",
  "system.timeout": "timed out",
  "system.report_error": "no valid report",
  "system.resume_unavailable": "previous session unavailable",
  "system.task_state_error": "task state error",
  "system.retry_exhausted": "retries used up",
  "system.interrupted": "interrupted",
  "system.internal_error": "internal error",
};
export const isSystemOutcome = (outcome: string) => outcome.startsWith("system.");
export const outcomeLabel = (outcome: string) => SYSTEM_LABEL[outcome] ?? outcome;

export function duration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function between(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  return Date.parse(to) - Date.parse(from);
}

export function clock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
}

export function ago(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds)) return iso;
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Ends author-supplied text as a sentence so following copy reads correctly. */
export const sentence = (text: string) =>
  /[.!?…:"”)]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
