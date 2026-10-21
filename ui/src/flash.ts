/** One-time confirmations carried to the page an action opens (e.g. a created run). */
const pending = new Map<string, string>();
export const setFlash = (key: string, text: string) => pending.set(key, text);
export const peekFlash = (key: string) => pending.get(key) ?? null;
export const clearFlash = (key: string) => pending.delete(key);
