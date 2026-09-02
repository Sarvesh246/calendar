"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createDebouncedStorage } from "./debounced-storage";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { nanoid } from "./nanoid";
import { defaultCategories, defaultItems, defaultReminderPresets } from "./mock-data";
import { buildImportPlan, feedLabel, type FetchedCalendar } from "./calendar-import";
import { mergeImportedItem, importedFieldsChanged } from "./source-snapshot";
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
  safeCategoryColor,
  safeCategoryName,
  type CloudSnapshot,
  type PendingChanges,
} from "./db-sync";
import {
  isDeleted,
  mergeTombstones,
  pruneTombstones,
  tombKey,
  time,
  type EntityKind,
  type TombstoneMap,
} from "./tombstones";
import { expandRepeat } from "./repeat";
import { mergeCalendars, type CalendarSnapshot } from "./merge-calendars";
import {
  sanitizeCategories,
  sanitizeImportSources,
  sanitizeSettings,
} from "./sanitize-store";
import type { DatebookBackup } from "./backup";
import type {
  Category,
  ImportSource,
  Item,
  ItemStatus,
  ReminderPreset,
  RepeatRule,
  UserSettings,
} from "./types";

export interface ImportResult {
  added: number;
  updated: number;
  removed: number;
}

export type SyncMode = "local" | "cloud";
export type SyncStatus = "idle" | "connecting" | "syncing" | "synced" | "error" | "merge";
export type CloudMergeChoice = "local" | "cloud" | "merge";

export interface MergeOffer {
  localItems: number;
  cloudItems: number;
}

interface DatebookState {
  categories: Category[];
  items: Item[];
  reminderPresets: ReminderPreset[];
  settings: UserSettings;
  importSources: ImportSource[];
  /** Deletes made on this device, so a reconcile can't resurrect them. Persisted. */
  deletions: TombstoneMap;

  // Cloud sync (transient — not persisted)
  mode: SyncMode;
  userId: string | null;
  syncStatus: SyncStatus;
  cloudError: string | null;
  mergeOffer: MergeOffer | null;
  lastConflict: string | null;

  addItem: (item: Omit<Item, "id" | "createdAt">) => Item;
  updateItem: (id: string, patch: Partial<Item>) => void;
  deleteItem: (id: string) => void;
  cycleItemStatus: (id: string) => void;
  setItemStatus: (id: string, status: ItemStatus) => void;
  toggleItemDone: (id: string) => void;

  addCategory: (category: Omit<Category, "id">) => Category;
  updateCategory: (id: string, patch: Partial<Category>) => void;
  deleteCategory: (id: string) => void;

  updateSettings: (patch: Partial<UserSettings>) => void;

  lastDeleted: Item | null;
  restoreLastDeleted: () => void;

  /** Merge a fetched calendar feed into the store, keyed by `url` (re-syncs in
   *  place rather than duplicating). Returns what changed. */
  applyImport: (url: string, feed: FetchedCalendar) => ImportResult;
  markImportError: (url: string, message: string) => void;
  removeImportSource: (id: string, deleteItems: boolean) => void;
  deleteSeries: (repeatId: string) => void;
  snoozeItem: (id: string, minutes?: number) => void;
  resetAllData: () => void;
  replaceFromBackup: (backup: DatebookBackup) => void;
  setItemRepeat: (id: string, rule: RepeatRule | undefined) => void;
  clearConflict: () => void;

  /** Load the signed-in user's data, adopt/merge local data, and start realtime sync. */
  connectCloud: (userId: string) => Promise<void>;
  /** Stop realtime sync and fall back to local (restores the pre-sign-in local data). */
  disconnectCloud: () => Promise<void>;
  /** User-triggered "Retry sync": clears every backoff timer and forces a fresh
   *  attempt — reconnect if the session is down, otherwise re-subscribe realtime,
   *  reconcile, and flush the write queue. */
  retrySync: () => Promise<void>;
  resolveCloudMerge: (choice: CloudMergeChoice) => Promise<void>;
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
  hideCompleted: false,
  defaultReminderPresetIds: ["rp-night"],
  mobileDayDetails: "sheet",
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
      deletions: {},
      lastDeleted: null,

      mode: "local",
      userId: null,
      syncStatus: "idle",
      cloudError: null,
      mergeOffer: null,
      lastConflict: null,

      addItem: (item) => {
        const createdAt = new Date().toISOString();
        if (item.repeat) {
          const seriesId = nanoid();
          const occs = expandRepeat(item.at, item.endAt, item.repeat);
          const created: Item[] = occs.map((occ) => {
            const id = nanoid();
            const row: Item = {
              ...item,
              ...occ,
              id,
              createdAt,
              updatedAt: createdAt,
              repeatId: seriesId,
              repeat: item.repeat,
            };
            if (row.reminders) {
              row.reminders = row.reminders.map((r) => ({ ...r, itemId: id }));
            }
            return row;
          });
          set({ items: [...get().items, ...created] });
          return created[0];
        }
        const newItem: Item = {
          ...item,
          id: nanoid(),
          createdAt,
          updatedAt: createdAt,
          reminders: item.reminders?.map((r) => ({ ...r, itemId: r.itemId || "" })),
        };
        if (newItem.reminders) {
          newItem.reminders = newItem.reminders.map((r) => ({ ...r, itemId: newItem.id }));
        }
        set({ items: [...get().items, newItem] });
        return newItem;
      },

      updateItem: (id, patch) => {
        set({
          items: get().items.map((i) => (i.id === id ? mergeItem(i, patch) : i)),
        });
      },

      deleteItem: (id) => {
        const item = get().items.find((i) => i.id === id) ?? null;
        set({
          items: get().items.filter((i) => i.id !== id),
          lastDeleted: item,
          deletions: addTombstones(get().deletions, "item", [id]),
        });
      },

      restoreLastDeleted: () => {
        const item = get().lastDeleted;
        if (!item) return;
        if (get().items.some((i) => i.id === item.id)) {
          set({ lastDeleted: null });
          return;
        }
        // Undo has to out-rank its own tombstone, or the next reconcile would
        // take the item straight back off the screen.
        set({
          items: [...get().items, { ...item, updatedAt: nowIso() }],
          lastDeleted: null,
          deletions: dropTombstones(get().deletions, "item", [item.id]),
        });
      },

      cycleItemStatus: (id) => {
        const order: ItemStatus[] = ["todo", "doing", "done"];
        set({
          items: get().items.map((i) => {
            if (i.id !== id || i.type === "event") return i;
            const current = i.status ?? "todo";
            const next = order[(order.indexOf(current) + 1) % order.length];
            return mergeItem(i, { status: next });
          }),
        });
      },

      setItemStatus: (id, status) => {
        set({
          items: get().items.map((i) =>
            i.id === id && i.type !== "event" ? mergeItem(i, { status }) : i
          ),
        });
      },

      toggleItemDone: (id) => {
        set({
          items: get().items.map((i) => {
            if (i.id !== id || i.type === "event") return i;
            const current = i.status ?? "todo";
            return mergeItem(i, { status: current === "done" ? "todo" : "done" });
          }),
        });
      },

      addCategory: (category) => {
        // `categories.name` and `.color` are NOT NULL in Postgres — a blank or
        // malformed value here would be pushed verbatim and stall the queue.
        const newCategory: Category = {
          ...category,
          name: safeCategoryName(category.name),
          color: safeCategoryColor(category.color),
          id: nanoid(),
          updatedAt: nowIso(),
        };
        set({ categories: [...get().categories, newCategory] });
        return newCategory;
      },

      updateCategory: (id, patch) => {
        // The name is left exactly as typed (the field has to be clearable
        // mid-edit); it's repaired on blur and again on the way to the cloud.
        const next = "color" in patch ? { ...patch, color: safeCategoryColor(patch.color) } : patch;
        set({
          categories: get().categories.map((c) =>
            c.id === id ? { ...c, ...next, updatedAt: nowIso() } : c
          ),
        });
      },

      deleteCategory: (id) => {
        const cats = get().categories;
        if (cats.length <= 1) return;
        const fallback = cats.find((c) => c.id !== id);
        if (!fallback) return;
        set({
          categories: cats.filter((c) => c.id !== id),
          items: get().items.map((i) =>
            i.categoryId === id ? { ...i, categoryId: fallback.id, updatedAt: nowIso() } : i
          ),
          deletions: addTombstones(get().deletions, "category", [id]),
        });
      },

      updateSettings: (patch) => {
        set({ settings: { ...get().settings, ...patch, updatedAt: nowIso() } });
      },

      applyImport: (url, feed) => {
        const state = get();
        const categories = sanitizeCategories(state.categories);
        const existing = state.importSources.find((s) => s.url === url);
        const sourceId = existing?.id ?? nanoid();

        const { newCategories, drafts } = buildImportPlan(feed, categories, sourceId);
        const incoming = new Map(drafts.map((d) => [d.sourceUid, d]));

        let added = 0;
        let updated = 0;

        // Update items already tied to this source; leave the user's status and
        // any locally edited feed fields alone.
        const merged = state.items.map((item) => {
          if (item.sourceId !== sourceId || !item.sourceUid) return item;
          const draft = incoming.get(item.sourceUid);
          if (!draft) return item;
          const next = mergeImportedItem(item, draft);
          if (!importedFieldsChanged(item, next)) return item;
          updated += 1;
          return { ...next, updatedAt: nowIso() };
        });

        const known = new Set(
          merged.filter((i) => i.sourceId === sourceId && i.sourceUid).map((i) => i.sourceUid)
        );

        // Drop items that vanished from the feed — but keep ones marked done.
        const dropped = merged.filter(
          (i) =>
            i.sourceId === sourceId &&
            i.sourceUid &&
            !incoming.has(i.sourceUid) &&
            i.status !== "done"
        );
        const droppedIds = new Set(dropped.map((i) => i.id));
        const pruned = merged.filter((i) => !droppedIds.has(i.id));
        const removed = dropped.length;

        for (const draft of drafts) {
          if (known.has(draft.sourceUid)) continue;
          pruned.push({ ...draft, id: nanoid(), createdAt: nowIso(), updatedAt: nowIso() });
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
          updatedAt: now,
        };

        set({
          items: pruned,
          categories: [...categories, ...newCategories.map((c) => ({ ...c, updatedAt: now }))],
          importSources: existing
            ? state.importSources.map((s) => (s.id === sourceId ? source : s))
            : [...state.importSources, source],
          // An event dropped from the feed is a delete like any other — without a
          // tombstone the other device pushes it straight back.
          deletions: addTombstones(state.deletions, "item", [...droppedIds]),
        });

        return { added, updated, removed };
      },

      removeImportSource: (id, deleteItems) => {
        set((state) => {
          const removedItemIds = deleteItems
            ? state.items.filter((i) => i.sourceId === id).map((i) => i.id)
            : [];
          const items = deleteItems
            ? state.items.filter((i) => i.sourceId !== id)
            : state.items.map((i) =>
                i.sourceId === id
                  ? { ...i, sourceId: undefined, sourceUid: undefined, updatedAt: nowIso() }
                  : i
              );
          const inUse = new Set(items.map((i) => i.categoryId));
          const categories = state.categories.filter((c) => c.sourceId !== id || inUse.has(c.id));
          const keptCategoryIds = new Set(categories.map((c) => c.id));
          let deletions = addTombstones(state.deletions, "import_source", [id]);
          deletions = addTombstones(deletions, "item", removedItemIds);
          deletions = addTombstones(
            deletions,
            "category",
            state.categories.filter((c) => !keptCategoryIds.has(c.id)).map((c) => c.id)
          );
          return {
            importSources: state.importSources.filter((s) => s.id !== id),
            items,
            categories,
            deletions,
          };
        });
      },

      markImportError: (url, message) => {
        set({
          importSources: get().importSources.map((s) =>
            s.url === url ? { ...s, lastError: message, updatedAt: nowIso() } : s
          ),
        });
      },

      deleteSeries: (repeatId) => {
        const gone = get().items.filter((i) => i.repeatId === repeatId).map((i) => i.id);
        set({
          items: get().items.filter((i) => i.repeatId !== repeatId),
          deletions: addTombstones(get().deletions, "item", gone),
        });
      },

      snoozeItem: (id, minutes = 15) => {
        const item = get().items.find((i) => i.id === id);
        if (!item) return;
        const fireAt = Date.now() + minutes * 60_000;
        const offsetMinutes = Math.round((new Date(item.at).getTime() - fireAt) / 60_000);
        const reminder = {
          id: nanoid(),
          itemId: id,
          offsetMinutes,
          label: `Snoozed ${minutes} min`,
        };
        set({
          items: get().items.map((i) =>
            i.id === id ? mergeItem(i, { reminders: [...(i.reminders ?? []), reminder] }) : i
          ),
        });
      },

      setItemRepeat: (id, rule) => {
        const item = get().items.find((i) => i.id === id);
        if (!item) return;
        const others = get().items.filter((i) => i.id !== id);
        if (!rule) {
          set({
            items: get().items.map((i) => {
              if (i.id !== id) return i;
              const next = { ...i, updatedAt: nowIso() };
              delete next.repeat;
              delete next.repeatId;
              return next;
            }),
          });
          return;
        }
        const seriesId = item.repeatId ?? nanoid();
        const occs = expandRepeat(item.at, item.endAt, rule);
        const created: Item[] = occs.map((occ, idx) => {
          if (idx === 0) {
            return { ...item, ...occ, repeat: rule, repeatId: seriesId, updatedAt: nowIso() };
          }
          const nid = nanoid();
          return {
            ...item,
            ...occ,
            id: nid,
            createdAt: nowIso(),
            updatedAt: nowIso(),
            repeat: rule,
            repeatId: seriesId,
            reminders: item.reminders?.map((r) => ({ ...r, itemId: nid })),
          };
        });
        const replaced = others.filter((i) => i.repeatId === seriesId).map((i) => i.id);
        const stripped = others.filter((i) => i.repeatId !== seriesId);
        const keep = new Set(created.map((i) => i.id));
        set({
          items: [...stripped, ...created],
          deletions: addTombstones(
            get().deletions,
            "item",
            replaced.filter((id) => !keep.has(id))
          ),
        });
      },

      resetAllData: () => {
        const s = get();
        set({
          items: [],
          categories: [...defaultCategories],
          reminderPresets: [...defaultReminderPresets],
          importSources: [],
          lastDeleted: null,
          settings: { ...s.settings, onboardingDismissed: false, updatedAt: nowIso() },
          // Reset means reset everywhere — without tombstones the next device to
          // reconcile pushes the whole calendar back up.
          deletions: tombstonesForWipe(s),
        });
      },

      replaceFromBackup: (backup) => {
        const prev = get();
        const categories = backup.categories?.length ? backup.categories : [...defaultCategories];
        const importSources = backup.importSources ?? [];
        const gone = <T extends { id: string }>(before: T[], after: T[]) => {
          const kept = new Set(after.map((x) => x.id));
          return before.filter((x) => !kept.has(x.id)).map((x) => x.id);
        };
        // Restoring a backup replaces the calendar, so everything it drops has to
        // be tombstoned — otherwise the other device pushes the old rows back.
        let deletions = addTombstones(prev.deletions, "item", gone(prev.items, backup.items ?? []));
        deletions = addTombstones(deletions, "category", gone(prev.categories, categories));
        deletions = addTombstones(
          deletions,
          "import_source",
          gone(prev.importSources, importSources)
        );
        const stamp = nowIso();
        set({
          deletions,
          items: (backup.items ?? []).map((i) => ({ ...i, updatedAt: stamp })),
          categories: categories.map((c) => ({ ...c, updatedAt: stamp })),
          reminderPresets: backup.reminderPresets?.length
            ? backup.reminderPresets
            : [...defaultReminderPresets],
          importSources: importSources.map((i) => ({ ...i, updatedAt: stamp })),
          settings: { ...(backup.settings ?? prev.settings), updatedAt: stamp },
          lastDeleted: null,
        });
      },

      clearConflict: () => set({ lastConflict: null }),

      connectCloud: async (userId) => {
        if (!supabase || activeUserId === userId || connecting) return;
        if (get().syncStatus === "merge" && pendingMerge?.userId === userId) return;
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
          let local = get();

          // Data left behind by a *different* account (someone signed in on this
          // device before, and the session was dropped rather than signed out).
          // It belongs to that account's cloud, not this one — adopting it here
          // used to offer to merge a stranger's calendar into your own.
          if (local.userId && local.userId !== userId) {
            applyingRemote = true;
            set({
              items: [],
              categories: [...defaultCategories],
              reminderPresets: [...defaultReminderPresets],
              importSources: [],
              deletions: {},
              lastDeleted: null,
              settings: defaultSettings,
              userId: null,
            });
            applyingRemote = false;
            clearPending();
            if (typeof localStorage !== "undefined") localStorage.removeItem(GUEST_BACKUP_KEY);
            local = get();
          }

          // Categories alone (seed rows from another device) are not "user data".
          // Treating them as a populated cloud would take the replace branch and
          // wipe local items the first time someone signs in.
          const cloudEmpty = cloud.items.length === 0;
          const localHasContent = local.items.length > 0 || local.categories.length > 0;
          const bothHaveItems = !cloudEmpty && local.items.length > 0;
          // Same account on this device — merge quietly instead of prompting.
          const isReconnect = local.userId === userId;
          const tombstones = pruneTombstones(mergeTombstones(local.deletions, cloud.deletions));

          applyingRemote = true;
          if (bothHaveItems) {
            if (isReconnect) {
              // App reopen on a device that was already syncing this account —
              // the persisted local snapshot is last session's cloud copy, not
              // guest data. Merge quietly and resume instead of re-prompting.
              const localSnap: CalendarSnapshot = {
                categories: local.categories,
                items: local.items,
                reminderPresets: local.reminderPresets,
                importSources: local.importSources,
                settings: local.settings,
              };
              const cloudSnap: CalendarSnapshot = {
                categories: cloud.categories,
                items: cloud.items,
                reminderPresets: cloud.reminderPresets.length
                  ? cloud.reminderPresets
                  : defaultReminderPresets,
                importSources: cloud.importSources,
                settings: cloud.settings ?? local.settings,
              };
              const merged = mergeCalendars(localSnap, cloudSnap, tombstones);
              set({
                ...merged,
                deletions: tombstones,
                mode: "cloud",
                userId,
                mergeOffer: null,
              });
              applyingRemote = false;
              activeUserId = userId;
              // Push only what the cloud is actually missing. Re-uploading the
              // whole calendar on every app open was slow enough on mobile to
              // time out, which surfaced as a sync error on a healthy account.
              queueDeltaAgainstCloud(merged, cloud);
              await subscribeRealtime(userId);
              connectRetries = 0;
              connecting = false;
              if (pendingWork()) {
                set({ syncStatus: "syncing", cloudError: null });
                scheduleFlush();
              } else {
                set({ syncStatus: "synced", cloudError: null });
              }
              return;
            }

            applyingRemote = false;
            connecting = false;
            pendingMerge = { userId, cloud };
            set({
              syncStatus: "merge",
              mergeOffer: {
                localItems: local.items.length,
                cloudItems: cloud.items.length,
              },
              userId,
              cloudError: null,
            });
            return;
          } else if (cloudEmpty && localHasContent) {
            // First sign-in with data on this device: keep it, push it up.
            set({
              settings: cloud.settings ?? local.settings,
              reminderPresets: cloud.reminderPresets.length
                ? cloud.reminderPresets
                : local.reminderPresets,
              deletions: tombstones,
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
            // The cloud is authoritative here — this device has no items of its
            // own. It can still hold *tombstones* though (a delete made offline,
            // possibly of the last item), and those have to be honoured or the
            // row reappears the moment the device comes back.
            const adopted = mergeCalendars(
              {
                categories: local.categories,
                items: local.items,
                reminderPresets: local.reminderPresets,
                importSources: local.importSources,
                settings: local.settings,
              },
              {
                categories: cloud.categories,
                items: cloud.items,
                reminderPresets: cloud.reminderPresets.length
                  ? cloud.reminderPresets
                  : defaultReminderPresets,
                importSources: cloud.importSources,
                settings: cloud.settings ?? local.settings,
              },
              tombstones
            );
            set({ ...adopted, deletions: tombstones, mode: "cloud", userId });
            applyingRemote = false;
            activeUserId = userId;
            // Covers both those offline deletes and the seed rows an account
            // predating the DB trigger is missing (settings, reminder presets):
            // whatever the cloud lacks is queued and pushed by the normal flush,
            // which already has retry and backoff.
            queueDeltaAgainstCloud(adopted, cloud);
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

      disconnectCloud: async () => {
        if (connectRetryTimer) {
          clearTimeout(connectRetryTimer);
          connectRetryTimer = null;
        }
        connectRetries = 0;
        connecting = false;
        desiredUserId = null;
        unsubscribeRealtime();

        // Drain any in-flight status edits before tearing down — sign-out used to
        // clear the debounced queue and drop "done" marks that never reached cloud.
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        if (activeUserId && supabase && pendingWork()) {
          try {
            await flush();
          } catch (err) {
            console.warn("[datebook] pre-sign-out flush failed:", err);
          }
        }

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
          deletions: {} as TombstoneMap,
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
              deletions: s.deletions ?? {},
            };
          } catch {
            /* fall back to the empty defaults above */
          }
        }

        applyingRemote = true;
        set({
          ...next,
          lastDeleted: null,
          mode: "local",
          userId: null,
          syncStatus: "idle",
          cloudError: null,
          mergeOffer: null,
          lastConflict: null,
        });
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

      resolveCloudMerge: async (choice) => {
        const pending = pendingMerge;
        if (!pending || !supabase) return;
        pendingMerge = null;
        const local = get();
        const cloudSnap: CalendarSnapshot = {
          categories: pending.cloud.categories,
          items: pending.cloud.items,
          reminderPresets: pending.cloud.reminderPresets.length
            ? pending.cloud.reminderPresets
            : defaultReminderPresets,
          importSources: pending.cloud.importSources,
          settings: pending.cloud.settings ?? local.settings,
        };
        const localSnap: CalendarSnapshot = {
          categories: local.categories,
          items: local.items,
          reminderPresets: local.reminderPresets,
          importSources: local.importSources,
          settings: local.settings,
        };
        const tombstones = pruneTombstones(
          mergeTombstones(local.deletions, pending.cloud.deletions)
        );

        let next: CalendarSnapshot;
        let deletions: TombstoneMap;
        if (choice === "cloud") {
          next = cloudSnap;
          // Adopting the cloud drops this device's local edits, so its pending
          // deletes go with them — keeping them would delete matching cloud rows.
          deletions = pruneTombstones(pending.cloud.deletions);
        } else if (choice === "local") {
          next = localSnap;
          deletions = pruneTombstones(local.deletions);
        } else {
          next = mergeCalendars(localSnap, cloudSnap, tombstones);
          deletions = tombstones;
        }

        applyingRemote = true;
        set({
          ...next,
          deletions,
          mode: "cloud",
          userId: pending.userId,
          mergeOffer: null,
          syncStatus: "syncing",
          cloudError: null,
        });
        applyingRemote = false;
        activeUserId = pending.userId;
        desiredUserId = pending.userId;
        if (choice !== "cloud") {
          // Diffing against the snapshot we fetched is what makes "use this
          // device" actually overwrite: cloud rows this device doesn't have
          // become deletes. The old wholesale upload left them behind, so they
          // reappeared on the next reconcile.
          queueDeltaAgainstCloud(next, pending.cloud);
        }
        await subscribeRealtime(pending.userId);
        connecting = false;
        if (pendingWork()) {
          set({ syncStatus: "syncing", cloudError: null });
          scheduleFlush();
        } else {
          set({ syncStatus: "synced", cloudError: null });
        }
      },
    }),
    {
      name: "datebook-store",
      version: 6,
      storage: createJSONStorage(() => createDebouncedStorage(250)),
      partialize: (s) => ({
        categories: s.categories,
        items: s.items,
        reminderPresets: s.reminderPresets,
        settings: s.settings,
        importSources: s.importSources,
        // Tombstones must outlive a reload: a delete made offline is only
        // honoured on reconnect if we still remember making it.
        deletions: s.deletions,
        mode: s.mode,
        userId: s.userId,
      }),
      migrate: (persisted, version) => {
        const state = persisted as Partial<DatebookState>;
        if (state && version < 1) {
          state.items = (state.items ?? []).filter((i) => !SAMPLE_ITEM_IDS.has(i.id));
          state.categories = (state.categories ?? []).filter((c) => !SAMPLE_CATEGORY_IDS.has(c.id));
          if (state.categories.length === 0) state.categories = defaultCategories;
        }
        if (state?.settings && state.settings.hideCompleted === undefined) {
          state.settings = { ...state.settings, hideCompleted: false };
        }
        if (state?.settings && state.settings.mobileDayDetails === undefined) {
          state.settings = { ...state.settings, mobileDayDetails: "sheet" };
        }
        if (state?.categories) {
          state.categories = sanitizeCategories(state.categories);
        }
        if (state?.importSources) {
          state.importSources = sanitizeImportSources(state.importSources);
        }
        if (state?.settings) {
          state.settings = sanitizeSettings(state.settings);
        }
        if (state && version < 6) {
          state.deletions = state.deletions ?? {};
          // Data written before edit times were recorded: seed `updatedAt` from
          // `createdAt` so a merge has something ordered to compare, rather than
          // treating every old row as infinitely stale.
          state.items = (state.items ?? []).map((i) =>
            i.updatedAt ? i : { ...i, updatedAt: i.createdAt }
          );
        }
        return state as DatebookState;
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const categories = sanitizeCategories(state.categories);
        const importSources = sanitizeImportSources(state.importSources);
        const settings = sanitizeSettings(state.settings);
        if (
          categories !== state.categories ||
          importSources !== state.importSources ||
          settings !== state.settings
        ) {
          queueMicrotask(() => {
            useDatebookStore.setState({ categories, importSources, settings });
          });
        }
      },
    }
  )
);

export function useCategory(id: string | undefined) {
  return useDatebookStore((s) => s.categories.find((c) => c.id === id));
}

function mergeItem(item: Item, patch: Partial<Item>): Item {
  // Every local edit carries the time it was made — that timestamp is what
  // decides the winner when this device and another have both touched the row.
  const next: Item = { ...item, ...patch, updatedAt: patch.updatedAt ?? nowIso() };
  if ("endAt" in patch && patch.endAt === undefined) delete next.endAt;
  if ("location" in patch && !patch.location) delete next.location;
  if ("description" in patch && !patch.description) delete next.description;
  if ("reminders" in patch && !patch.reminders?.length) delete next.reminders;
  if (patch.status !== undefined && item.type !== "event") {
    if (patch.status === "done") {
      if (item.status !== "done") next.completedAt = patch.completedAt ?? new Date().toISOString();
    } else {
      delete next.completedAt;
    }
  }
  return next;
}

/* ================================================================== */
/* Cloud sync engine                                                   */
/* ================================================================== */
/* Local edits are captured by diffing each store transition and       */
/* pushed to Supabase on a short debounce. Realtime changes from other  */
/* devices are applied back into the store behind `applyingRemote` so   */
/* they don't loop back out as writes.                                  */

const nowIso = () => new Date().toISOString();

function addTombstones(current: TombstoneMap, kind: EntityKind, ids: string[]): TombstoneMap {
  if (ids.length === 0) return current;
  const at = nowIso();
  // Prune here so a device that never signs in doesn't accumulate tombstones for
  // the life of the install.
  const next = pruneTombstones(current);
  for (const id of ids) next[tombKey(kind, id)] = at;
  return next;
}

function dropTombstones(current: TombstoneMap, kind: EntityKind, ids: string[]): TombstoneMap {
  const next = { ...current };
  for (const id of ids) delete next[tombKey(kind, id)];
  return next;
}

/** Tombstone everything currently in the store — used by "delete all data",
 *  which has to mean deleted on every device, not just this one. */
function tombstonesForWipe(s: {
  items: Item[];
  categories: Category[];
  importSources: ImportSource[];
  deletions: TombstoneMap;
}): TombstoneMap {
  let out = addTombstones(s.deletions, "item", s.items.map((i) => i.id));
  out = addTombstones(out, "category", s.categories.map((c) => c.id));
  out = addTombstones(out, "import_source", s.importSources.map((i) => i.id));
  return out;
}

let applyingRemote = false;
let suspended = false;
let activeUserId: string | null = null;
let pendingMerge: { userId: string; cloud: CloudSnapshot } | null = null;
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
  deletions: TombstoneMap;
} = {
  categories: { upserts: new Map(), deletes: new Set() },
  reminderPresets: { upserts: new Map(), deletes: new Set() },
  importSources: { upserts: new Map(), deletes: new Set() },
  items: { upserts: new Map(), deletes: new Set() },
  settingsDirty: false,
  deletions: {},
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
  pending.deletions = mergeTombstones(pending.deletions, useDatebookStore.getState().deletions);
}

/**
 * Queue exactly what the cloud is missing after a reconcile.
 *
 * The reconcile itself runs behind `applyingRemote`, so the store subscriber
 * never sees it — before this, a row merged in from a local offline edit was
 * shown on screen and then never pushed, leaving the two devices different until
 * something else happened to touch it. Diffing the merged result against the
 * snapshot we just fetched also turns "tombstoned away" into a real cloud
 * delete, which is what makes a delete stick.
 */
function queueDeltaAgainstCloud(next: CalendarSnapshot, cloud: CloudSnapshot) {
  accumulate("categories", cloud.categories, next.categories);
  accumulate("reminderPresets", cloud.reminderPresets, next.reminderPresets);
  accumulate("importSources", cloud.importSources, next.importSources);
  accumulate("items", cloud.items, next.items);
  if (!cloud.settings || JSON.stringify(cloud.settings) !== JSON.stringify(next.settings)) {
    pending.settingsDirty = true;
  }
  const local = useDatebookStore.getState().deletions;
  for (const [key, at] of Object.entries(local)) {
    if (!cloud.deletions[key]) pending.deletions[key] = at;
  }
}

function clearPending() {
  for (const k of ["categories", "reminderPresets", "importSources", "items"] as CollKey[]) {
    pending[k].upserts.clear();
    pending[k].deletes.clear();
  }
  pending.settingsDirty = false;
  pending.deletions = {};
}

function pendingWork() {
  return (
    pending.settingsDirty ||
    Object.keys(pending.deletions).length > 0 ||
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
  pending.deletions = mergeTombstones(batch.deletions, pending.deletions);
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
    deletions: pending.deletions,
  };
  pending.settingsDirty = false;
  pending.deletions = {};

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
  if (state.deletions !== prev.deletions) {
    for (const [key, at] of Object.entries(state.deletions)) {
      if (prev.deletions[key] !== at) {
        pending.deletions[key] = at;
        changed = true;
      }
    }
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
const ENTITY_FOR_COLL: Record<CollKey, EntityKind> = {
  categories: "category",
  items: "item",
  reminderPresets: "reminder_preset",
  importSources: "import_source",
};
const COLL_FOR_ENTITY: Record<EntityKind, CollKey> = {
  category: "categories",
  item: "items",
  reminder_preset: "reminderPresets",
  import_source: "importSources",
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
        // Don't let an older broadcast undo a preference the user just changed
        // here — settings are one row, so a stale echo would revert the panel.
        if (time(incoming.updatedAt) < time(current.updatedAt)) return;
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
    if (table === "deletions") {
      applyRemoteTombstone(payload);
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
      // Remember the delete even if we didn't have the row: a later reconcile
      // must not read "cloud is missing it" as "we haven't uploaded it yet".
      useDatebookStore.setState((st) => ({
        deletions: { ...st.deletions, [tombKey(ENTITY_FOR_COLL[key], id)]: nowIso() },
      }));
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
      const stamped = model as { id: string; updatedAt?: string; createdAt?: string };

      // A row we deleted here, re-broadcast by a device that hadn't heard about
      // the delete yet. Re-assert it rather than letting the item reappear.
      const tombstones = useDatebookStore.getState().deletions;
      const kind = ENTITY_FOR_COLL[key];
      if (isDeleted(tombstones, kind, stamped)) {
        const bucket = pending[key] as unknown as { deletes: Set<string> };
        bucket.deletes.add(model.id);
        pending.deletions[tombKey(kind, model.id)] =
          tombstones[tombKey(kind, model.id)] ?? nowIso();
        scheduleFlush();
        return;
      }

      const idx = current.findIndex((x) => x.id === model.id);
      if (idx !== -1) {
        const prev = current[idx] as { id: string; updatedAt?: string; createdAt?: string };
        const mine = time(prev.updatedAt ?? prev.createdAt);
        const theirs = time(stamped.updatedAt ?? stamped.createdAt);
        if (mine > theirs && JSON.stringify(prev) !== JSON.stringify(model)) {
          // This device holds the newer edit. The old code dropped the remote
          // row here and did nothing else, so whichever side lost the race stayed
          // wrong until something happened to touch the row again — and it only
          // looked back 30 seconds. Keep the local edit *and* push it.
          const b = pending[key] as unknown as { upserts: Map<string, unknown> };
          b.upserts.set(prev.id, prev);
          scheduleFlush();
          if (key === "items") {
            useDatebookStore.setState({ lastConflict: (model as Item).title || "an item" });
          }
          return;
        }
      }
      nextArr = idx === -1 ? [...current, model] : current.map((x, i) => (i === idx ? model : x));
    }
    useDatebookStore.setState({ [key]: nextArr } as Partial<DatebookState>);
  } finally {
    applyingRemote = false;
  }
}

/** A delete recorded on another device. Apply it here so the row goes away even
 *  if we missed the row's own DELETE event (a frozen mobile socket, say). */
function applyRemoteTombstone(payload: RealtimePostgresChangesPayload<Record<string, unknown>>) {
  if (payload.eventType === "DELETE") return;
  const r = payload.new as { entity?: string; entity_id?: string; deleted_at?: string };
  if (!r?.entity || !r.entity_id) return;
  const kind = r.entity as EntityKind;
  const coll = COLL_FOR_ENTITY[kind];
  if (!coll) return;
  const id = String(r.entity_id);
  const key = tombKey(kind, id);
  const at = r.deleted_at ? new Date(r.deleted_at).toISOString() : nowIso();

  const st = useDatebookStore.getState();
  if (time(st.deletions[key]) >= time(at)) return;

  const rows = st[coll] as { id: string; updatedAt?: string; createdAt?: string }[];
  const kept = rows.filter((x) => x.id !== id || time(x.updatedAt ?? x.createdAt) > time(at));
  useDatebookStore.setState({
    deletions: { ...st.deletions, [key]: at },
    ...(kept.length !== rows.length ? ({ [coll]: kept } as Partial<DatebookState>) : {}),
  });
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

/** Rows the cloud no longer has (and that aren't waiting to be pushed) were
 *  deleted elsewhere — drop them instead of resurrecting them in the merge. */
function dropRemotelyDeleted<T extends { id: string }>(local: T[], cloud: T[]): T[] {
  if (local.length === 0) return local;
  const ids = new Set(cloud.map((x) => x.id));
  const next = local.filter((x) => ids.has(x.id));
  return next.length === local.length ? local : next;
}

/** Same, but an imported item may legitimately exist under a different id on
 *  each device; the feed's own UID identifies it across them. */
function dropRemotelyDeletedItems(local: Item[], cloud: Item[]): Item[] {
  if (local.length === 0) return local;
  const ids = new Set(cloud.map((i) => i.id));
  const uids = new Set(cloud.filter((i) => i.sourceUid).map((i) => i.sourceUid as string));
  const next = local.filter((i) => ids.has(i.id) || (i.sourceUid ? uids.has(i.sourceUid) : false));
  return next.length === local.length ? local : next;
}

/** Pull the full cloud snapshot and apply it — used after a realtime gap
 *  (reconnect, or returning from the background) where change events were missed.
 *  Local unsynced edits take priority: if any are queued we push instead. */
async function catchUpFromCloud(userId: string) {
  if (!supabase || activeUserId !== userId) return;
  // `flush()` drains `pending` at start, so `pendingWork()` is false while
  // those writes are still in flight. Skip catch-up until flush finishes.
  if (pendingWork() || flushing) {
    scheduleFlush();
    return;
  }
  try {
    const cloud = await withTimeout(fetchAllForUser(supabase, userId), "Reconciling");
    if (activeUserId !== userId) return;
    if (pendingWork() || flushing) {
      scheduleFlush();
      return;
    }
    const local = useDatebookStore.getState();
    const tombstones = pruneTombstones(mergeTombstones(local.deletions, cloud.deletions));
    // Nothing is queued and nothing is in flight, so every local row has
    // already been accepted by the cloud. Anything the cloud no longer has was
    // therefore deleted on another device — union-merging it back is how a
    // deletion used to "come back from the dead" on the next reconnect.
    const merged = mergeCalendars(
      {
        categories: dropRemotelyDeleted(local.categories, cloud.categories),
        items: dropRemotelyDeletedItems(local.items, cloud.items),
        reminderPresets: local.reminderPresets,
        importSources: dropRemotelyDeleted(local.importSources, cloud.importSources),
        settings: local.settings,
      },
      {
        categories: cloud.categories,
        items: cloud.items,
        reminderPresets: cloud.reminderPresets.length
          ? cloud.reminderPresets
          : defaultReminderPresets,
        importSources: cloud.importSources,
        settings: cloud.settings ?? local.settings,
      },
      tombstones
    );
    applyingRemote = true;
    useDatebookStore.setState({
      items: merged.items,
      categories: merged.categories,
      reminderPresets: merged.reminderPresets,
      importSources: merged.importSources,
      settings: merged.settings,
      deletions: tombstones,
    });
    applyingRemote = false;
    // The reconcile ran behind `applyingRemote`, so the subscriber saw none of
    // it — queue the difference explicitly, or anything merged in locally
    // (offline edits, deletes) would never make it back up.
    queueDeltaAgainstCloud(merged, cloud);
    if (pendingWork()) scheduleFlush();
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
  const tables = [
    "categories",
    "items",
    "reminder_presets",
    "import_sources",
    "user_settings",
    "deletions",
  ];
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
      const busy = pendingWork() || flushing;
      useDatebookStore.setState({
        syncStatus: busy ? "syncing" : "synced",
        cloudError: null,
      });
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

    // The write queue gives up after a capped run of failures so a poison write
    // can't hammer the server. Coming back from offline/background is exactly
    // the event that makes those writes worth trying again, so reset the budget
    // — otherwise one flaky patch left sync dead until the user tapped "Retry".
    clearFlushRetry();

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
      if (pendingWork()) scheduleFlush();
    })();
  };
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("online", resume);
  window.addEventListener("focus", resume);
}
