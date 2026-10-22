import { type Doc, HARNESSES } from "./workflow-edit.ts";

export interface EffortPreferences {
  defaults: Record<string, string>;
  recent: Record<string, string[]>;
}

// Suggestions match the adapters; OpenCode variants depend on the chosen provider/model.
export const EFFORT_SUGGESTIONS: Record<string, readonly string[]> = {
  codex: ["low", "medium", "high", "xhigh"],
  claude: ["low", "medium", "high", "xhigh", "max"],
  pi: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  omp: ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"],
  opencode: [],
};

export function readEffortPreferences(text: string | null): EffortPreferences {
  const result: EffortPreferences = { defaults: {}, recent: {} };
  try {
    const parsed: unknown = JSON.parse(text ?? "null");
    if (!parsed || typeof parsed !== "object") return result;
    const value = parsed as Record<string, unknown>;
    for (const harness of HARNESSES) {
      const defaults = value.defaults as Record<string, unknown> | undefined;
      const recent = value.recent as Record<string, unknown> | undefined;
      if (typeof defaults?.[harness] === "string") result.defaults[harness] = defaults[harness];
      const entries = recent?.[harness];
      if (Array.isArray(entries))
        result.recent[harness] = [
          ...new Set(entries.filter((v): v is string => typeof v === "string" && !!v.trim())),
        ].slice(0, 12);
    }
  } catch {
    // Missing or damaged browser preferences never prevent editing a workflow.
  }
  return result;
}

export function rememberEffort(
  prefs: EffortPreferences,
  harness: string,
  value: string,
): EffortPreferences {
  const effort = value.trim();
  if (!effort || !HARNESSES.includes(harness as (typeof HARNESSES)[number])) return prefs;
  return {
    ...prefs,
    recent: {
      ...prefs.recent,
      [harness]: [effort, ...(prefs.recent[harness] ?? []).filter((v) => v !== effort)].slice(
        0,
        12,
      ),
    },
  };
}

/** Only callers creating new steps apply preferences. Loaded workflows are never rewritten. */
export function applyEffortDefaults(
  doc: Doc,
  prefs: EffortPreferences,
  ids = Object.keys(doc.steps),
): Doc {
  const steps = { ...doc.steps };
  for (const id of ids) {
    const step = steps[id];
    if (step?.kind !== "agent" || step.reasoning_effort !== undefined) continue;
    const effort = prefs.defaults[step.harness]?.trim();
    if (effort) steps[id] = { ...step, reasoning_effort: effort };
  }
  return { ...doc, steps };
}
