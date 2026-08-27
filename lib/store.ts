"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "./nanoid";
import { defaultCategories, defaultItems, defaultReminderPresets } from "./mock-data";
import type {
  AppearancePreset,
  Category,
  Density,
  Item,
  ItemStatus,
  LandingView,
  ReminderPreset,
  UserSettings,
} from "./types";

interface DatebookState {
  categories: Category[];
  items: Item[];
  reminderPresets: ReminderPreset[];
  settings: UserSettings;

  addItem: (item: Omit<Item, "id" | "createdAt">) => Item;
  updateItem: (id: string, patch: Partial<Item>) => void;
  deleteItem: (id: string) => void;
  cycleItemStatus: (id: string) => void;

  addCategory: (category: Omit<Category, "id">) => Category;
  updateCategory: (id: string, patch: Partial<Category>) => void;

  updateSettings: (patch: Partial<UserSettings>) => void;
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
