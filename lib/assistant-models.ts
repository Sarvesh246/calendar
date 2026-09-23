"use client";

import { create } from "zustand";

export type AssistantModelOption = {
  id: string;
  label: string;
  model: string;
  tier: 1 | 2;
};

const STORAGE_KEY = "datebook-assistant-model";

interface AssistantModelState {
  models: AssistantModelOption[];
  selectedId: string;
  loaded: boolean;
  loading: boolean;
  load: () => Promise<void>;
  select: (id: string) => void;
}

export const useAssistantModelStore = create<AssistantModelState>((set, get) => ({
  models: [],
  selectedId: "auto",
  loaded: false,
  loading: false,
  load: async () => {
    if (get().loading || get().loaded) return;
    let selectedId = "auto";
    try {
      selectedId = localStorage.getItem(STORAGE_KEY) || "auto";
    } catch {
      /* private mode */
    }
    set({ loading: true, selectedId });
    try {
      const response = await fetch("/api/assistant/models", { cache: "no-store" });
      const data = (await response.json()) as { models?: AssistantModelOption[] };
      const models = Array.isArray(data.models) ? data.models : [];
      if (selectedId !== "auto" && !models.some((model) => model.id === selectedId)) selectedId = "auto";
      set({ models, selectedId, loaded: true, loading: false });
    } catch {
      set({ models: [], selectedId: "auto", loaded: true, loading: false });
    }
  },
  select: (id) => {
    const selectedId = id === "auto" || get().models.some((model) => model.id === id) ? id : "auto";
    set({ selectedId });
    try {
      localStorage.setItem(STORAGE_KEY, selectedId);
    } catch {
      /* private mode */
    }
  },
}));
