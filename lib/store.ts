"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "./nanoid";
import { defaultCategories, defaultItems, defaultReminderPresets } from "./mock-data";
import { buildImportPlan, feedLabel, type FetchedCalendar } from "./calendar-import";
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

interface DatebookState {
  categories: Category[];
  items: Item[];
  reminderPresets: ReminderPreset[];
  settings: UserSettings;
  importSources: ImportSource[];

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

export const useDatebookStore = create<DatebookState>()(
  persist(
    (set, get) => ({
      categories: defaultCategories,
      items: defaultItems,
      reminderPresets: defaultReminderPresets,
      settings: defaultSettings,
      importSources: [],

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
    }),
    {
      name: "datebook-store",
      version: 1,
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
