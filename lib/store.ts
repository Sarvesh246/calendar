"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { nanoid } from "./nanoid";
import { defaultCategories, defaultItems, defaultReminderPresets } from "./mock-data";
import { buildImportPlan, feedLabel, type FetchedCalendar } from "./calendar-import";
import { supabase } from "./supabase/client";
import {
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
            ["title", "description", "location", "at", "endAt", "allDay", "type", "categoryId"] as const
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
        if (!supabase || activeUserId === userId) return;
        set({ syncStatus: "connecting" });
        try {
          if (typeof localStorage !== "undefined" && !localStorage.getItem(GUEST_BACKUP_KEY)) {
            const raw = localStorage.getItem("datebook-store");
            if (raw) localStorage.setItem(GUEST_BACKUP_KEY, raw);
          }

          const cloud = await fetchAllForUser(supabase, userId);
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
            await pushAllToCloud(supabase, userId, {
              categories: s.categories,
              items: s.items,
              reminderPresets: s.reminderPresets,
              importSources: s.importSources,
              settings: s.settings,
            });
            suspended = false;
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
            if (!cloud.settings || cloud.reminderPresets.length === 0) {
              suspended = true;
              await pushAllToCloud(supabase, userId, {
                categories: [],
                items: [],
                importSources: [],
                reminderPresets: cloud.reminderPresets.length ? [] : defaultReminderPresets,
                settings: cloud.settings ? null : defaultSettings,
              });
              suspended = false;
            }
          }

          subscribeRealtime(userId);
          set({ syncStatus: "synced", cloudError: null });
          if (pendingWork()) scheduleFlush();
        } catch (err) {
          applyingRemote = false;
          suspended = false;
          set({
            syncStatus: "error",
            cloudError: err instanceof Error ? err.message : String(err),
          });
        }
      },

      disconnectCloud: () => {
        unsubscribeRealtime();
        activeUserId = null;
        suspended = false;
        clearPending();

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
let channel: RealtimeChannel | null = null;

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

  try {
    const knownCategoryIds = new Set(useDatebookStore.getState().categories.map((c) => c.id));
    await pushChanges(supabase, activeUserId, batch, knownCategoryIds);
    useDatebookStore.setState({ syncStatus: "synced", cloudError: null });
  } catch (err) {
    requeue(batch);
    useDatebookStore.setState({
      syncStatus: "error",
      cloudError: err instanceof Error ? err.message : String(err),
    });
  } finally {
    flushing = false;
    if (pendingWork()) scheduleFlush();
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
        useDatebookStore.setState({ settings: rowToSettings(payload.new) });
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
      const model = REALTIME_MAP[key](payload.new as Record<string, unknown>);
      const idx = current.findIndex((x) => x.id === model.id);
      nextArr = idx === -1 ? [...current, model] : current.map((x, i) => (i === idx ? model : x));
    }
    useDatebookStore.setState({ [key]: nextArr } as Partial<DatebookState>);
  } finally {
    applyingRemote = false;
  }
}

function subscribeRealtime(userId: string) {
  if (!supabase) return;
  unsubscribeRealtime();
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
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      useDatebookStore.setState({ syncStatus: "error", cloudError: "Realtime connection lost" });
    }
  });
  channel = ch;
}

function unsubscribeRealtime() {
  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
}
