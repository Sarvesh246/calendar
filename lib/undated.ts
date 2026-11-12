/** Stable storage representation for a task without a due date. The existing
 * item and sync schemas require a timestamp; never present this marker as a
 * calendar date or schedule reminders from it. */
export const UNDATED_AT = "9999-12-31T12:00:00.000Z";

export function isUndatedAt(at: unknown): boolean {
  return typeof at === "string" && +new Date(at) === +new Date(UNDATED_AT);
}

export function isUndated(item: { type: string; at: string }): boolean {
  return item.type !== "event" && isUndatedAt(item.at);
}
