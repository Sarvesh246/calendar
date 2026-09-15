import type { Item } from "./types";
import type { SyncMode, SyncStatus } from "./store";

/**
 * "Did that save?"
 *
 * Datebook writes to `localStorage` the instant you stop typing and, when
 * signed in, pushes to Postgres a beat later — but it never said so. Silence is
 * fine while everything works and quietly alarming the moment it doesn't: an
 * edit made in a lift with no signal looked exactly like an edit made online,
 * right up until it vanished.
 *
 * The rule this encodes: say the least true thing that is reassuring, and only
 * linger when there is something the person might need to act on.
 *
 *  - Local-only, signed out       → "Saved on this device", briefly.
 *  - Signed in, pushed            → "Saved", briefly.
 *  - Signed in, queued or offline → "Waiting to sync", until it clears.
 *  - Failed                       → "Couldn't sync" with a retry, until it clears.
 *  - Status flips (done/doing)    → never: those already have a Completed toast.
 */

/** Fields a complete / start / reopen write is allowed to touch. */
const STATUS_ONLY_KEYS = new Set([
  "status",
  "completedAt",
  "statusAt",
  "updatedAt",
]);

/**
 * True when every changed item differs only in status / completion timestamps.
 * Completing an assignment already shows its own "Completed" snackbar — the
 * save pill must not pile on.
 */
export function isStatusOnlyItemsChange(prev: Item[], next: Item[]): boolean {
  if (prev.length !== next.length) return false;
  const prevById = new Map(prev.map((item) => [item.id, item]));
  let sawStatusEdit = false;

  for (const item of next) {
    const before = prevById.get(item.id);
    if (!before) return false;
    if (before === item) continue;

    const keys = new Set([...Object.keys(before), ...Object.keys(item)]) as Set<keyof Item>;
    for (const key of keys) {
      if (before[key] === item[key]) continue;
      if (!STATUS_ONLY_KEYS.has(key)) return false;
      if (key === "status" || key === "completedAt" || key === "statusAt") {
        sawStatusEdit = true;
      }
    }
  }

  return sawStatusEdit;
}

export type SaveTone = "saved" | "pending" | "error";

export interface SaveStatusView {
  tone: SaveTone;
  title: string;
  detail: string | null;
  /** Show a Retry control. */
  retry: boolean;
  /**
   * `true` when this is a reassurance that should fade on its own; `false`
   * when it describes a state the person may want to do something about, and
   * should stay until the state itself changes.
   */
  transient: boolean;
}

export interface SaveStatusInput {
  mode: SyncMode;
  syncStatus: SyncStatus;
  /** `navigator.onLine`, as last observed. */
  online: boolean;
  /** Writes sitting in the outbound queue. */
  queued: number;
  error?: string | null;
}

export function describeSaveStatus(input: SaveStatusInput): SaveStatusView {
  const { mode, syncStatus, online, queued, error } = input;

  if (mode !== "cloud") {
    return {
      tone: "saved",
      title: "Saved on this device",
      detail: null,
      retry: false,
      transient: true,
    };
  }

  if (!online) {
    return {
      tone: "pending",
      title: "Waiting to sync",
      detail:
        queued > 0
          ? `Saved here. ${queued} change${queued === 1 ? "" : "s"} will upload when you're back online.`
          : "Saved here. It'll upload when you're back online.",
      retry: false,
      transient: false,
    };
  }

  if (syncStatus === "error") {
    return {
      tone: "error",
      title: "Couldn't sync",
      detail: error?.trim() || "Your changes are saved on this device.",
      retry: true,
      transient: false,
    };
  }

  if (syncStatus === "syncing" || syncStatus === "connecting") {
    return {
      tone: "pending",
      title: "Saving…",
      detail: null,
      retry: false,
      transient: true,
    };
  }

  if (queued > 0) {
    return {
      tone: "pending",
      title: "Waiting to sync",
      detail: `Saved here. ${queued} change${queued === 1 ? "" : "s"} still to upload.`,
      retry: false,
      transient: false,
    };
  }

  return {
    tone: "saved",
    title: "Saved",
    detail: null,
    retry: false,
    transient: true,
  };
}
