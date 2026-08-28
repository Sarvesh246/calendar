"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { nanoid } from "./nanoid";
import { defaultCategories, defaultItems, defaultReminderPresets } from "./mock-data";
import { buildImportPlan, feedLabel, type FetchedCalendar } from "./calendar-import";
import { supabase } from "./supabase/client";
import {
  describeError,
  diffCollection,
  fetchAllForUser,
  pushAllToCloud,
  pushChanges,
  rowToCategory,
  rowToImportSource,
  rowToItem,
  rowToPreset,
  rowToSettings,
  type PendingChanges,
} from "./db-sync";
import type {
  Category,
  ImportSource,
  Item,
  ItemStatus,
  ReminderPreset,
  UserSettings,
} from "./types";

export interface ImportResult {
  added: number;
  updated: number;
  removed: number;
}

export type SyncMode = "local" | "cloud";
export type SyncStatus = "idle" | "connecting" | "syncing" | "synced" | "error";

interface DatebookState {
  categories: Category[];
  items: Item[];
  reminderPresets: ReminderPreset[];
  settings: UserSettings;
  importSources: ImportSource[];

  // Cloud sync (transient — not persisted)
  mode: SyncMode;
  userId: string | null;
  syncStatus: SyncStatus;
  cloudError: string | null;

  addItem: (item: Omit<Item, "id" | "createdAt">) => Item;
  updateItem: (id: string, patch: Partial<Item>) => void;
  deleteItem: (id: string) => void;
  cycleItemStatus: (id: string) => void;
  setItemStatus: (id: string, status: ItemStatus) => void;
  toggleItemDone: (id: string) => void;

  addCategory: (category: Omit<Category, "id">) => Category;
  updateCategory: (id: string, patch: Partial<Category>) => void;

  updateSettings: (patch: Partial<UserSettings>) => void;

  /** Merge a fetched calendar feed into the store, keyed by `url` (re-syncs in
   *  place rather than duplicating). Returns what changed. */
  applyImport: (url: string, feed: FetchedCalendar) => ImportResult;
  removeImportSource: (id: string, deleteItems: boolean) => void;

  /** Load the signed-in user's data, adopt/merge local data, and start realtime sync. */
  connectCloud: (userId: string) => Promise<void>;
  /** Stop realtime sync and fall back to local (restores the pre-sign-in local data). */
  disconnectCloud: () => void;
  /** User-triggered "Retry sync": clears every backoff timer and forces a fresh
   *  attempt — reconnect if the session is down, otherwise re-subscribe realtime,
   *  reconcile, and flush the write queue. */
  retrySync: () => Promise<void>;
}

// IDs of the old seeded demo content, stripped from any store that persisted it
// before the app switched to starting empty.
const SAMPLE_ITEM_IDS = new Set(Array.from({ length: 12 }, (_, i) => `item-${i + 1}`));
const SAMPLE_CATEGORY_IDS = new Set(["cat-cs", "cat-bio", "cat-club"]);

const defaultSettings: UserSettings = {
  preset: "minimal",
  landingView: "today",
  density: "comfortable",
  weekStartsOn: 0,
  clock24h: false,
  showLocation: true,
  showCategoryDot: true,
  defaultReminderPresetIds: ["rp-night"],
};

const GUEST_BACKUP_KEY = "datebook-store.guest";

export const useDatebookStore = create<DatebookState>()(
  persist(
    (set, get) => ({
      categories: defaultCategories,
      items: defaultItems,
      reminderPresets: defaultReminderPresets,
      settings: defaultSettings,
      importSources: [],

      mode: "local",
      userId: null,
      syncStatus: "idle",
      cloudError: null,

      addItem: (item) => {
        const newItem: Item = { ...item, id: nanoid(), createdAt: new Date().toISOString() };
        set({ items: [...get().items, newItem] });
        return newItem;
      },

      updateItem: (id, patch) => {
        set({ items: get().items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
      },

      deleteItem: (id) => {
        set({ items: get().items.filter((i) => i.id !== id) });
      },

      cycleItemStatus: (id) => {
        const order: ItemStatus[] = ["todo", "doing", "done"];
        set({
          items: get().items.map((i) => {
            if (i.id !== id || !i.status) return i;
            const next = order[(order.indexOf(i.status) + 1) % order.length];
            return { ...i, status: next };
          }),
        });
      },

      setItemStatus: (id, status) => {
        set({
          items: get().items.map((i) => (i.id === id && i.status ? { ...i, status } : i)),
        });
      },

      toggleItemDone: (id) => {
        set({
          items: get().items.map((i) => {
            if (i.id !== id || !i.status) return i;
            return { ...i, status: i.status === "done" ? "todo" : "done" };
          }),
        });
      },

      addCategory: (category) => {
        const newCategory: Category = { ...category, id: nanoid() };
        set({ categories: [...get().categories, newCategory] });
        return newCategory;
      },

      updateCategory: (id, patch) => {
        set({ categories: get().categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
      },

      updateSettings: (patch) => {
        set({ settings: { ...get().settings, ...patch } });
      },

      applyImport: (url, feed) => {
        const state = get();
        const existing = state.importSources.find((s) => s.url === url);
        const sourceId = existing?.id ?? nanoid();

        const { newCategories, drafts } = buildImportPlan(feed, state.categories, sourceId);
        const incoming = new Map(drafts.map((d) => [d.sourceUid, d]));

        let added = 0;
        let updated = 0;

        // Update items already tied to this source; leave the user's status alone.
        const merged = state.items.map((item) => {
          if (item.sourceId !== sourceId || !item.sourceUid) return item;
          const draft = incoming.get(item.sourceUid);
          if (!draft) return item;
          const next = {
            ...item,
            ...draft,
            id: item.id,
            createdAt: item.createdAt,
            status: item.status ?? draft.status,
          };
          const changed = (
            ["title", "description", "location", "url", "at", "endAt", "allDay", "type", "categoryId"] as const
          ).some((k) => next[k] !== item[k]);
          if (changed) updated += 1;
          return changed ? next : item;
        });

        const known = new Set(
          merged.filter((i) => i.sourceId === sourceId && i.sourceUid).map((i) => i.sourceUid)
        );

        // Drop items that vanished from the feed — but keep ones marked done.
        const beforePrune = merged.length;
        const pruned = merged.filter(
          (i) =>
            i.sourceId !== sourceId ||
            !i.sourceUid ||
            incoming.has(i.sourceUid) ||
            i.status === "done"
        );
        const removed = beforePrune - pruned.length;

        for (const draft of drafts) {
          if (known.has(draft.sourceUid)) continue;
          pruned.push({ ...draft, id: nanoid(), createdAt: new Date().toISOString() });
          added += 1;
        }

        const now = new Date().toISOString();
        const name = feed.calendarName?.trim() || existing?.name || feedLabel(url);
        const source: ImportSource = {
          id: sourceId,
          url,
          name,
          addedAt: existing?.addedAt ?? now,
          lastSyncedAt: now,
          itemCount: drafts.length,
        };

        set({
          items: pruned,
          categories: [...state.categories, ...newCategories],
          importSources: existing
            ? state.importSources.map((s) => (s.id === sourceId ? source : s))
            : [...state.importSources, source],
        });

        return { added, updated, removed };
      },

      removeImportSource: (id, deleteItems) => {
        set((state) => {
          const items = deleteItems
            ? state.items.filter((i) => i.sourceId !== id)
            : state.items.map((i) =>
                i.sourceId === id ? { ...i, sourceId: undefined, sourceUid: undefined } : i
              );
          const inUse = new Set(items.map((i) => i.categoryId));
          return {
            importSources: state.importSources.filter((s) => s.id !== id),
            items,
            // Drop categories auto-created for this feed once nothing references them.
            categories: state.categories.filter((c) => c.sourceId !== id || inUse.has(c.id)),
          };
        });
      },

      connectCloud: async (userId) => {
        if (!supabase || activeUserId === userId || connecting) return;
        connecting = true;
        desiredUserId = userId;
        if (connectRetryTimer) {
          clearTimeout(connectRetryTimer);
          connectRetryTimer = null;
        }
        clearFlushRetry();
        bindConnectivityListeners();
        set({ syncStatus: "connecting" });
        try {
          // Snapshot the current guest data so signing out restores it. Keyed on
          // "am I still local?" rather than "does a backup already exist?" — the
          // old check meant a *second* guest session (after one sign-out) was
          // never re-captured, so its edits were lost on the next sign-out.
          if (typeof localStorage !== "undefined" && get().mode === "local") {
            const raw = localStorage.getItem("datebook-store");
            if (raw) localStorage.setItem(GUEST_BACKUP_KEY, raw);
          }

          // Legacy local data (or the old default categories) may carry non-UUID
          // ids that the Postgres `uuid` columns reject — remap them first.
          const fixed = normalizeLocalIds(get());
          if (fixed) {
            applyingRemote = true;
            set(fixed);
            applyingRemote = false;
          }

          const cloud = await withTimeout(
            fetchAllForUser(supabase, userId),
            "Loading your calendar"
          );
          const local = get();
          const cloudEmpty = cloud.items.length === 0 && cloud.categories.length === 0;
          const localHasContent = local.items.length > 0 || local.categories.length > 0;

          applyingRemote = true;
          if (cloudEmpty && localHasContent) {
            // First sign-in with data on this device: keep it, push it up.
            set({
              settings: cloud.settings ?? local.settings,
              reminderPresets: cloud.reminderPresets.length
                ? cloud.reminderPresets
                : local.reminderPresets,
              mode: "cloud",
              userId,
            });
            applyingRemote = false;
            suspended = true;
            activeUserId = userId;
            const s = get();
            try {
              await withTimeout(
                pushAllToCloud(supabase, userId, {
                  categories: s.categories,
                  items: s.items,
                  reminderPresets: s.reminderPresets,
                  importSources: s.importSources,
                  settings: s.settings,
                }),
                "Uploading your calendar"
              );
              suspended = false;
            } catch (pushErr) {
              // A partial or failed first upload must NOT roll the whole connect
              // back — a later retry would then see a half-populated cloud, take
              // the "cloud wins" branch below, and wipe the local data that never
              // made it up. Instead: stay connected, keep local authoritative,
              // and hand the entire dataset to the debounced flush (which has its
              // own capped backoff) to finish the job.
              suspended = false;
              console.error("[datebook] initial upload failed; queueing for retry:", pushErr);
              queueEntireLocalState(get());
            }
          } else {
            set({
              items: cloud.items,
              categories: cloud.categories,
              reminderPresets: cloud.reminderPresets.length
                ? cloud.reminderPresets
                : defaultReminderPresets,
              importSources: cloud.importSources,
              settings: cloud.settings ?? defaultSettings,
              mode: "cloud",
              userId,
            });
            applyingRemote = false;
            activeUserId = userId;
            // Backfill seed rows if this account predates the DB trigger.
            // Best-effort: a failure here shouldn't block the connect.
            if (!cloud.settings || cloud.reminderPresets.length === 0) {
              suspended = true;
              try {
                await withTimeout(
                  pushAllToCloud(supabase, userId, {
                    categories: [],
                    items: [],
                    importSources: [],
                    reminderPresets: cloud.reminderPresets.length ? [] : defaultReminderPresets,
                    settings: cloud.settings ? null : defaultSettings,
                  }),
                  "Preparing your account"
                );
              } catch (seedErr) {
                console.warn("[datebook] seed backfill failed (non-fatal):", seedErr);
              }
              suspended = false;
            }
          }

          await subscribeRealtime(userId);
          connectRetries = 0;
          connecting = false;
          if (pendingWork()) {
            // Unsent local edits (or a retried first upload) remain — show the
            // work in progress rather than a premature "synced".
            set({ syncStatus: "syncing", cloudError: null });
            scheduleFlush();
          } else {
            set({ syncStatus: "synced", cloudError: null });
          }
        } catch (err) {
          // Roll back so a later retry (auto-retry below / reload / next auth
          // event) re-runs cleanly.
          applyingRemote = false;
          suspended = false;
          activeUserId = null;
          unsubscribeRealtime();
          clearPending();
          clearFlushRetry();
          connecting = false;
          console.error("[datebook] cloud connect failed:", err);
          set({ syncStatus: "error", cloudError: describeError(err) });
          scheduleConnectRetry(userId);
        }
      },

      disconnectCloud: () => {
        if (connectRetryTimer) {
          clearTimeout(connectRetryTimer);
          connectRetryTimer = null;
        }
        connectRetries = 0;
        connecting = false;
        desiredUserId = null;
        unsubscribeRealtime();
        activeUserId = null;
        suspended = false;
        clearPending();
        clearFlushRetry();

        let next = {
          items: [] as Item[],
          categories: [...defaultCategories],
          reminderPresets: [...defaultReminderPresets],
          importSources: [] as ImportSource[],
          settings: defaultSettings as UserSettings,
        };
        const guest =
          typeof localStorage !== "undefined" ? localStorage.getItem(GUEST_BACKUP_KEY) : null;
        if (guest) {
          try {
            const s = (JSON.parse(guest).state ?? {}) as Partial<DatebookState>;
            next = {
              items: s.items ?? [],
              categories: s.categories ?? [...defaultCategories],
              reminderPresets: s.reminderPresets ?? [...defaultReminderPresets],
              importSources: s.importSources ?? [],
              settings: s.settings ?? defaultSettings,
            };
          } catch {
            /* fall back to the empty defaults above */
          }
        }

        applyingRemote = true;
        set({ ...next, mode: "local", userId: null, syncStatus: "idle", cloudError: null });
        applyingRemote = false;

        // Drop the consumed snapshot so the next sign-in re-captures whatever the
        // user does as a guest from here, instead of restoring this stale copy.
        if (typeof localStorage !== "undefined") localStorage.removeItem(GUEST_BACKUP_KEY);
      },

      retrySync: async () => {
        const uid = get().userId ?? desiredUserId;
        if (!supabase || !uid) return;

        // Wipe every backoff path so one tap always makes a real attempt.
        if (connectRetryTimer) {
          clearTimeout(connectRetryTimer);
          connectRetryTimer = null;
        }
        connectRetries = 0;
        clearFlushRetry();

        if (activeUserId === uid) {
          // Session is live — the failure is in the realtime channel or the
          // write queue. Rejoin (subscribeRealtime reconciles itself once the
          // channel reports SUBSCRIBED), then push whatever is pending.
          set({ syncStatus: "syncing", cloudError: null });
          try {
            await subscribeRealtime(uid);
          } catch (err) {
            console.warn("[datebook] retry resubscribe failed:", err);
          }
          // `flush()` guards on its own `flushing` flag, so a still-in-flight
          // batch is left to finish rather than racing a second push.
          if (pendingWork()) {
            await flush();
          } else if (useDatebookStore.getState().syncStatus !== "error") {
            set({ syncStatus: "synced", cloudError: null });
          }
        } else {
          // Session never came up (or was torn down) — start a clean connect.
          connecting = false;
          await get().connectCloud(uid);
        }
      },
    }),
    {
      name: "datebook-store",
      version: 1,
      partialize: (s) => ({
        categories: s.categories,
        items: s.items,
        reminderPresets: s.reminderPresets,
        settings: s.settings,
        importSources: s.importSources,
      }),
      migrate: (persisted, version) => {
        const state = persisted as Partial<DatebookState>;
        if (state && version < 1) {
          state.items = (state.items ?? []).filter((i) => !SAMPLE_ITEM_IDS.has(i.id));
          state.categories = (state.categories ?? []).filter((c) => !SAMPLE_CATEGORY_IDS.has(c.id));
          if (state.categories.length === 0) state.categories = defaultCategories;
        }
        return state as DatebookState;
      },
    }
  )
);

export function useCategory(id: string | undefined) {
  return useDatebookStore((s) => s.categories.find((c) => c.id === id));
}

/* ================================================================== */
/* Cloud sync engine                                                   */
/* ================================================================== */
/* Local edits are captured by diffing each store transition and       */
/* pushed to Supabase on a short debounce. Realtime changes from other  */
/* devices are applied back into the store behind `applyingRemote` so   */
/* they don't loop back out as writes.                                  */

let applyingRemote = false;
let suspended = false;
let activeUserId: string | null = null;
// The user we WANT to be synced as — set the moment connectCloud starts, and
// kept even while `activeUserId` is briefly null between a failed connect and
// its retry. Lets the connectivity listeners relaunch a dead connect.
let desiredUserId: string | null = null;
let channel: RealtimeChannel | null = null;

// Resilience: the initial cloud connect and the realtime channel both retry with
// backoff instead of stopping at the first failure, and a backgrounded tab
// re-joins + reconciles when it returns to the foreground.
let connecting = false;
let connectRetries = 0;
let connectRetryTimer: ReturnType<typeof setTimeout> | null = null;
let realtimeRetries = 0;
let realtimeRetryTimer: ReturnType<typeof setTimeout> | null = null;
let lastResumeAt = 0;
let connectivityBound = false;

// Any single Supabase round-trip that hangs past this is treated as a failure so
// the backoff/retry path runs instead of the engine wedging on a pending await
// (which would leave `connecting`/`flushing` stuck and every retry a no-op).
const SYNC_TIMEOUT_MS = 15_000;

function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label} timed out — check your connection and retry.`)),
      SYNC_TIMEOUT_MS
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string) => UUID_RE.test(v);
const newId = () => nanoid();

/**
 * Categories / items / import sources land in Postgres `uuid` columns. Legacy
 * local data (and the pre-UUID default categories) can have slug ids like
 * "cat-personal" — remap those to real UUIDs, rewriting item.categoryId refs.
 * Returns a partial state to `set()`, or null when nothing needed fixing.
 */
function normalizeLocalIds(state: {
  categories: Category[];
  items: Item[];
  importSources: ImportSource[];
}): Partial<DatebookState> | null {
  const remap = new Map<string, string>();
  const fix = <T extends { id: string }>(rows: T[]): T[] =>
    rows.map((r) => {
      if (isUuid(r.id)) return r;
      const next = newId();
      remap.set(r.id, next);
      return { ...r, id: next };
    });

  const categories = fix(state.categories);
  const importSources = fix(state.importSources);
  const items = fix(state.items).map((it) => {
    const mapped = it.categoryId && remap.get(it.categoryId);
    const sourceMapped = it.sourceId && remap.get(it.sourceId);
    if (!mapped && !sourceMapped) return it;
    return {
      ...it,
      ...(mapped ? { categoryId: mapped } : {}),
      ...(sourceMapped ? { sourceId: sourceMapped } : {}),
    };
  });

  return remap.size > 0 ? { categories, items, importSources } : null;
}

type CollKey = "categories" | "reminderPresets" | "importSources" | "items";

const pending: {
  categories: { upserts: Map<string, Category>; deletes: Set<string> };
  reminderPresets: { upserts: Map<string, ReminderPreset>; deletes: Set<string> };
  importSources: { upserts: Map<string, ImportSource>; deletes: Set<string> };
  items: { upserts: Map<string, Item>; deletes: Set<string> };
  settingsDirty: boolean;
} = {
  categories: { upserts: new Map(), deletes: new Set() },
  reminderPresets: { upserts: new Map(), deletes: new Set() },
  importSources: { upserts: new Map(), deletes: new Set() },
  items: { upserts: new Map(), deletes: new Set() },
  settingsDirty: false,
};

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

// Failed flushes retry on a capped exponential backoff rather than the 350ms
// debounce — a permanently-rejecting write (a poison row, an RLS/schema problem)
// used to re-fire every 350ms forever, hammering the server and pinning the UI
// in a "syncing"⇄"error" flicker. After the cap it stops; "Retry sync" resets it.
let flushRetries = 0;
let flushRetryTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_MAX_RETRIES = 6;

function clearFlushRetry() {
  if (flushRetryTimer) {
    clearTimeout(flushRetryTimer);
    flushRetryTimer = null;
  }
  flushRetries = 0;
}

function scheduleFlushRetry() {
  if (flushRetryTimer || !activeUserId) return;
  if (flushRetries >= FLUSH_MAX_RETRIES) return; // give up until a manual retry
  const delay = Math.min(30_000, 1000 * 2 ** flushRetries);
  flushRetries += 1;
  flushRetryTimer = setTimeout(() => {
    flushRetryTimer = null;
    void flush();
  }, delay);
}

/** Load the whole current store into the pending queue — used when the first
 *  post-sign-in upload fails, so the normal debounced flush finishes it. */
function queueEntireLocalState(s: {
  categories: Category[];
  reminderPresets: ReminderPreset[];
  importSources: ImportSource[];
  items: Item[];
}) {
  for (const c of s.categories) pending.categories.upserts.set(c.id, c);
  for (const r of s.reminderPresets) pending.reminderPresets.upserts.set(r.id, r);
  for (const i of s.importSources) pending.importSources.upserts.set(i.id, i);
  for (const it of s.items) pending.items.upserts.set(it.id, it);
  pending.settingsDirty = true;
}

function clearPending() {
  for (const k of ["categories", "reminderPresets", "importSources", "items"] as CollKey[]) {
    pending[k].upserts.clear();
    pending[k].deletes.clear();
  }
  pending.settingsDirty = false;
}

function pendingWork() {
  return (
    pending.settingsDirty ||
    (["categories", "reminderPresets", "importSources", "items"] as CollKey[]).some(
      (k) => pending[k].upserts.size > 0 || pending[k].deletes.size > 0
    )
  );
}

function accumulate<T extends { id: string }>(
  key: CollKey,
  prev: T[],
  next: T[]
): boolean {
  if (prev === next) return false;
  const { upserts, deletes } = diffCollection(prev, next);
  if (upserts.length === 0 && deletes.length === 0) return false;
  const bucket = pending[key] as unknown as { upserts: Map<string, T>; deletes: Set<string> };
  for (const row of upserts) {
    bucket.upserts.set(row.id, row);
    bucket.deletes.delete(row.id);
  }
  for (const id of deletes) {
    bucket.deletes.add(id);
    bucket.upserts.delete(id);
  }
  return true;
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, 350);
}

function drain<T extends { id: string }>(bucket: { upserts: Map<string, T>; deletes: Set<string> }) {
  const out = { upserts: [...bucket.upserts.values()], deletes: [...bucket.deletes] };
  bucket.upserts.clear();
  bucket.deletes.clear();
  return out;
}

function requeue(batch: PendingChanges) {
  for (const key of ["categories", "reminderPresets", "importSources", "items"] as CollKey[]) {
    const b = batch[key] as { upserts: { id: string }[]; deletes: string[] };
    const bucket = pending[key] as unknown as {
      upserts: Map<string, { id: string }>;
      deletes: Set<string>;
    };
    for (const row of b.upserts) if (!bucket.deletes.has(row.id)) bucket.upserts.set(row.id, row);
    for (const id of b.deletes) {
      bucket.deletes.add(id);
      bucket.upserts.delete(id);
    }
  }
  if (batch.settings) pending.settingsDirty = true;
}

async function flush() {
  if (flushing || suspended || !activeUserId || !supabase) return;
  if (!pendingWork()) return;
  flushing = true;
  useDatebookStore.setState({ syncStatus: "syncing" });

  const batch: PendingChanges = {
    categories: drain(pending.categories),
    reminderPresets: drain(pending.reminderPresets),
    importSources: drain(pending.importSources),
    items: drain(pending.items),
    settings: pending.settingsDirty ? useDatebookStore.getState().settings : null,
  };
  pending.settingsDirty = false;

  let ok = false;
  try {
    const knownCategoryIds = new Set(useDatebookStore.getState().categories.map((c) => c.id));
    await withTimeout(
      pushChanges(supabase, activeUserId, batch, knownCategoryIds),
      "Sync"
    );
    clearFlushRetry();
    useDatebookStore.setState({ syncStatus: "synced", cloudError: null });
    ok = true;
  } catch (err) {
    requeue(batch);
    console.error("[datebook] cloud sync failed:", err);
    useDatebookStore.setState({ syncStatus: "error", cloudError: describeError(err) });
  } finally {
    flushing = false;
  }

  if (ok) {
    // More edits landed while this batch was in flight — debounce another pass.
    if (pendingWork()) scheduleFlush();
  } else {
    // Back off; don't tight-loop on a write that keeps failing.
    scheduleFlushRetry();
  }
}

// Diff every store transition; queue the delta when cloud-connected.
useDatebookStore.subscribe((state, prev) => {
  if (applyingRemote || !activeUserId || !supabase) return;
  let changed = false;
  changed = accumulate("categories", prev.categories, state.categories) || changed;
  changed = accumulate("reminderPresets", prev.reminderPresets, state.reminderPresets) || changed;
  changed = accumulate("importSources", prev.importSources, state.importSources) || changed;
  changed = accumulate("items", prev.items, state.items) || changed;
  if (state.settings !== prev.settings) {
    pending.settingsDirty = true;
    changed = true;
  }
  if (changed) scheduleFlush();
});

const REALTIME_KEY: Record<string, CollKey> = {
  categories: "categories",
  items: "items",
  reminder_presets: "reminderPresets",
  import_sources: "importSources",
};
const REALTIME_MAP: Record<CollKey, (r: Record<string, unknown>) => { id: string }> = {
  categories: rowToCategory,
  items: rowToItem,
  reminderPresets: rowToPreset,
  importSources: rowToImportSource,
};

function applyRealtime(
  table: string,
  payload: RealtimePostgresChangesPayload<Record<string, unknown>>
) {
  applyingRemote = true;
  try {
    if (table === "user_settings") {
      if (payload.eventType !== "DELETE" && payload.new) {
        const incoming = rowToSettings(payload.new);
        const current = useDatebookStore.getState().settings;
        // The echo of our own settings write lands ~half a second later; applying
        // an identical value would re-commit the store (and re-run the theme
        // recalc) for nothing — visible as a stutter while flicking through
        // appearance presets.
        if (JSON.stringify(incoming) !== JSON.stringify(current)) {
          useDatebookStore.setState({ settings: incoming });
        }
      }
      return;
    }
    const key = REALTIME_KEY[table];
    if (!key) return;
    const current = useDatebookStore.getState()[key] as { id: string }[];
    let nextArr: { id: string }[];
    if (payload.eventType === "DELETE") {
      const id = (payload.old as { id?: string })?.id;
      if (!id) return;
      nextArr = current.filter((x) => x.id !== id);
      if (nextArr.length === current.length) return;
    } else {
      let model: { id: string };
      try {
        // Defensive: if a table somehow isn't REPLICA IDENTITY FULL, an UPDATE
        // payload carries only the changed columns and the mapper's date coercion
        // throws on the missing `at`/`created_at`. Fall back to a full reconcile
        // rather than letting the row get half-written or the callback throw.
        model = REALTIME_MAP[key](payload.new as Record<string, unknown>);
        if (!model.id) throw new Error("realtime row missing id");
      } catch {
        if (activeUserId) void catchUpFromCloud(activeUserId);
        return;
      }
      const idx = current.findIndex((x) => x.id === model.id);
      nextArr = idx === -1 ? [...current, model] : current.map((x, i) => (i === idx ? model : x));
    }
    useDatebookStore.setState({ [key]: nextArr } as Partial<DatebookState>);
  } finally {
    applyingRemote = false;
  }
}

/** Re-run the initial connect after a failure, with capped exponential backoff.
 *  Past the cap the user can still force it with the "Retry sync" button. */
function scheduleConnectRetry(userId: string) {
  if (connectRetryTimer || !supabase) return;
  if (connectRetries >= 6) {
    // Out of automatic retries — leave a clear call to action for the user.
    useDatebookStore.setState((s) => ({
      syncStatus: "error",
      cloudError:
        s.cloudError ?? "Couldn't reach the server. Tap “Retry sync” to try again.",
    }));
    return;
  }
  const delay = Math.min(20_000, 1500 * 2 ** connectRetries);
  connectRetries += 1;
  connectRetryTimer = setTimeout(async () => {
    connectRetryTimer = null;
    if (activeUserId || connecting || !supabase) return;
    const { data } = await supabase.auth.getSession();
    if (data.session?.user?.id === userId) {
      void useDatebookStore.getState().connectCloud(userId);
    }
  }, delay);
}

/** Pull the full cloud snapshot and apply it — used after a realtime gap
 *  (reconnect, or returning from the background) where change events were missed.
 *  Local unsynced edits take priority: if any are queued we push instead. */
async function catchUpFromCloud(userId: string) {
  if (!supabase || activeUserId !== userId) return;
  if (pendingWork()) {
    scheduleFlush();
    return;
  }
  try {
    const cloud = await withTimeout(fetchAllForUser(supabase, userId), "Reconciling");
    if (activeUserId !== userId) return;
    applyingRemote = true;
    useDatebookStore.setState({
      items: cloud.items,
      categories: cloud.categories,
      reminderPresets: cloud.reminderPresets.length
        ? cloud.reminderPresets
        : defaultReminderPresets,
      importSources: cloud.importSources,
      ...(cloud.settings ? { settings: cloud.settings } : {}),
    });
    applyingRemote = false;
  } catch (err) {
    applyingRemote = false;
    console.warn("[datebook] catch-up pull failed:", err);
  }
}

const REALTIME_MAX_RETRIES = 8;

/** Rejoin the realtime channel after a drop, with capped backoff. Keeps the
 *  synced data on screen and shows a soft "connecting" while retrying; once the
 *  cap is hit it surfaces an error with a manual-retry prompt. */
function scheduleRealtimeReconnect(userId: string) {
  if (!supabase || activeUserId !== userId || realtimeRetryTimer) return;
  if (realtimeRetries >= REALTIME_MAX_RETRIES) {
    // The channel won't come back on its own — stop the quiet loop and let the
    // user force a full reconnect. Queued writes still flush independently.
    useDatebookStore.setState({
      syncStatus: "error",
      cloudError: "Live sync keeps dropping. Tap “Retry sync” to reconnect.",
    });
    return;
  }
  const delay = Math.min(30_000, 1000 * 2 ** realtimeRetries);
  realtimeRetries += 1;
  const st = useDatebookStore.getState().syncStatus;
  if (st === "synced" || st === "idle") {
    useDatebookStore.setState({ syncStatus: "connecting" });
  }
  realtimeRetryTimer = setTimeout(() => {
    realtimeRetryTimer = null;
    if (activeUserId === userId) void subscribeRealtime(userId);
  }, delay);
}

async function subscribeRealtime(userId: string) {
  if (!supabase) return;
  unsubscribeRealtime();
  // Make sure the realtime socket carries the current user's JWT before joining.
  // Right after sign-in the token can lag the auth event; joining without it used
  // to fail with CHANNEL_ERROR and surface a spurious sync error on first load.
  try {
    await supabase.realtime.setAuth();
  } catch {
    /* best effort — the subscribe callback retries on failure anyway */
  }
  const ch = supabase.channel(`datebook:${userId}`);
  const tables = ["categories", "items", "reminder_presets", "import_sources", "user_settings"];
  for (const table of tables) {
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table, filter: `user_id=eq.${userId}` },
      (payload) => applyRealtime(table, payload as RealtimePostgresChangesPayload<Record<string, unknown>>)
    );
  }
  ch.subscribe((status) => {
    if (channel !== ch || activeUserId !== userId) return;
    if (status === "SUBSCRIBED") {
      realtimeRetries = 0;
      if (realtimeRetryTimer) {
        clearTimeout(realtimeRetryTimer);
        realtimeRetryTimer = null;
      }
      useDatebookStore.setState({ syncStatus: "synced", cloudError: null });
      // Any changes emitted while we were disconnected are gone — reconcile.
      void catchUpFromCloud(userId);
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      scheduleRealtimeReconnect(userId);
    }
  });
  channel = ch;
}

function unsubscribeRealtime() {
  if (realtimeRetryTimer) {
    clearTimeout(realtimeRetryTimer);
    realtimeRetryTimer = null;
  }
  realtimeRetries = 0;
  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
}

/** Rejoin realtime + reconcile when the tab returns to the foreground or the
 *  network comes back. Mobile browsers freeze WebSockets on background and the
 *  channel often doesn't recover on its own. Bound once, on first connect. */
function bindConnectivityListeners() {
  if (connectivityBound || typeof window === "undefined") return;
  connectivityBound = true;
  const resume = () => {
    if (!supabase) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const now = Date.now();
    if (now - lastResumeAt < 2500) return;
    lastResumeAt = now;

    // Session never came up (a failed initial connect that exhausted its
    // retries) — relaunch it now that the tab/network is back.
    if (!activeUserId) {
      if (desiredUserId && !connecting) {
        connectRetries = 0;
        void useDatebookStore.getState().connectCloud(desiredUserId);
      }
      return;
    }

    const uid = activeUserId;
    void (async () => {
      try {
        await supabase.realtime.setAuth();
      } catch {
        /* ignore */
      }
      await subscribeRealtime(uid);
      void catchUpFromCloud(uid);
    })();
  };
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("online", resume);
  window.addEventListener("focus", resume);
}
