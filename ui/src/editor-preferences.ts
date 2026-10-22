import { useSyncExternalStore } from "react";
import { type EffortPreferences, readEffortPreferences } from "./lib/effort-preferences.ts";

const KEY = "workflowz:effort-preferences:v1";
const listeners = new Set<() => void>();
const read = () => {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
let snapshot = { prefs: readEffortPreferences(read()), persistent: true };
const notify = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const effortPreferences = () => snapshot.prefs;
export function saveEffortPreferences(prefs: EffortPreferences) {
  let persistent = true;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    persistent = false;
  }
  snapshot = { prefs, persistent };
  notify();
}
window.addEventListener("storage", (event) => {
  if (event.key === KEY || event.key === null) {
    snapshot = { prefs: readEffortPreferences(read()), persistent: true };
    notify();
  }
});
export const useEffortPreferences = () => useSyncExternalStore(subscribe, () => snapshot);
