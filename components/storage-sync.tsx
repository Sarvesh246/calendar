"use client";

import { useEffect } from "react";
import { useDatebookStore } from "@/lib/store";

/** Rehydrate from localStorage when another tab writes the store. */
export function StorageSync() {
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "datebook-store" || event.newValue === null) return;
      // Only adopt remote tab data in local mode — cloud sync handles its own merge.
      const { mode } = useDatebookStore.getState();
      if (mode === "cloud") return;
      void useDatebookStore.persist.rehydrate();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return null;
}
