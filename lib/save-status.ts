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
 */

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
