"use client";

/**
 * Half-finished text survives the interruption.
 *
 * Typing on a phone is constantly interrupted — a notification, the app going
 * to the background, a mis-swipe that dismisses the sheet, iOS reclaiming the
 * tab while you check something. Every one of those used to throw away whatever
 * was in the quick-add field or the assistant box, which is the single most
 * annoying thing a small app can do.
 *
 * Drafts live in `sessionStorage` under one key per surface. Session, not
 * local: an abandoned draft should not still be sitting there in a week, but it
 * absolutely should still be there when you come back thirty seconds later.
 */

const PREFIX = "datebook-draft:";

export type DraftKey = "quick-add" | "quick-add-fields" | "assistant" | "focus-session" | `item:${string}`;

function storage(): Storage | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function readDraft(key: DraftKey): string {
  const store = storage();
  if (!store) return "";
  try {
    return store.getItem(PREFIX + key) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(key: DraftKey, value: string) {
  const store = storage();
  if (!store) return;
  try {
    // An empty draft is the absence of a draft, not a draft of "". Keeping the
    // row would make `readDraft` return "" either way but leaves litter behind
    // for every field ever focused.
    if (value.trim() === "") store.removeItem(PREFIX + key);
    else store.setItem(PREFIX + key, value);
  } catch {
    /* Quota or private mode — typing still works, it just won't survive. */
  }
}

export function clearDraft(key: DraftKey) {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/**
 * A draft that is an object rather than a sentence — the composer's chip
 * corrections, which are as much a part of "what I was in the middle of" as the
 * words are. Losing "…but on Friday, for BIOL" while keeping the title would be
 * its own small betrayal.
 */
export function readJsonDraft<T>(key: DraftKey, isValid: (value: unknown) => value is T): T | null {
  const raw = readDraft(key);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeJsonDraft(key: DraftKey, value: object) {
  const keys = Object.keys(value);
  if (keys.length === 0) {
    clearDraft(key);
    return;
  }
  writeDraft(key, JSON.stringify(value));
}
