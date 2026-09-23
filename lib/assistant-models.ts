"use client";

import { create } from "zustand";

export type AssistantModelOption = {
  id: string;
  label: string;
  model: string;
  tier: 1 | 2;
};

const STORAGE_KEY = "datebook-assistant-model";
const RETRY_MS = 15_000;
let lastAttempt = 0;

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
    const state = get();
    if (state.loading) return;
    // An empty or failed result is not final: retry (throttled) so a cold start,
    // rate limit or offline launch doesn't pin the picker to "Auto" until relaunch.
    if (state.loaded && state.models.length > 0) return;
    if (state.loaded && Date.now() - lastAttempt < RETRY_MS) return;
    lastAttempt = Date.now();
    let selectedId = state.loaded ? state.selectedId : "auto";
    if (!state.loaded) {
      try {
        selectedId = localStorage.getItem(STORAGE_KEY) || "auto";
      } catch {
        /* private mode */
      }
    }
    set({ loading: true, selectedId });
    try {
      const response = await fetch("/api/assistant/models", { cache: "no-store" });
      const data = (await response.json()) as { models?: AssistantModelOption[] };
      const models = response.ok && Array.isArray(data.models) ? data.models : [];
      if (selectedId !== "auto" && models.length > 0 && !models.some((model) => model.id === selectedId)) selectedId = "auto";
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
