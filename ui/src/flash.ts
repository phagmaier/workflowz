/** One-time confirmations carried to the page an action opens (e.g. a created run). */
interface Flash {
  text: string;
  status: "ready" | "paused";
  revisionId: number | undefined;
}
const pending = new Map<string, Flash>();
export const setFlash = (key: string, text: string, status: Flash["status"], revisionId?: number) =>
  pending.set(key, { text, status, revisionId });
export const peekFlash = (key: string) => pending.get(key) ?? null;
export const clearFlash = (key: string) => pending.delete(key);
