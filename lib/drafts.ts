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

export type DraftKey = "quick-add" | "assistant" | `item:${string}`;

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
