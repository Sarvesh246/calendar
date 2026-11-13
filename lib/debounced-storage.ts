import type { PersistStorage, StorageValue } from "zustand/middleware";

/**
 * Whether the last write to localStorage failed (quota full, storage blocked).
 * Persist's own error handling is silent, so without this a full store simply
 * stops saving and edits vanish on reload. The save-status pill subscribes.
 */
let writeFailed = false;
const healthListeners = new Set<() => void>();

function setWriteFailed(next: boolean) {
  if (writeFailed === next) return;
  writeFailed = next;
  for (const l of healthListeners) l();
}

export function subscribeStorageHealth(listener: () => void): () => void {
  healthListeners.add(listener);
  return () => {
    healthListeners.delete(listener);
  };
}
export const getStorageWriteFailed = () => writeFailed;
export const getServerStorageWriteFailed = () => false;

function writeLocal(name: string, value: string) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(name, value);
    setWriteFailed(false);
  } catch (err) {
    // Quota exceeded / private mode. Losing the write is survivable; a thrown
    // error inside persist's middleware is not — so swallow it, but tell the
    // UI, because a silent loss is the worst outcome.
    setWriteFailed(true);
    console.warn("[datebook] couldn't write to localStorage:", err);
  }
}

/** Debounced localStorage adapter for Zustand persist — reduces main-thread jank on bulk writes. */
export function createDebouncedStorage(delayMs = 250) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { name: string; value: string } | null = null;

  const commit = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pending) return;
    writeLocal(pending.name, pending.value);
    pending = null;
  };

  // A debounced write that is still waiting when the tab is hidden or closed is
  // a lost edit — on iOS a backgrounded PWA is often frozen and never resumed.
  // `pagehide` and `visibilitychange` are the two events that reliably fire
  // there; both just flush whatever is queued.
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", commit);
    window.addEventListener("beforeunload", commit);
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") commit();
    });
  }

  return {
    getItem: (name: string) => {
      if (pending?.name === name) return pending.value;
      try {
        return typeof localStorage === "undefined" ? null : localStorage.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name: string, value: string) => {
      pending = { name, value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(commit, delayMs);
    },
    removeItem: (name: string) => {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
      try {
        if (typeof localStorage !== "undefined") localStorage.removeItem(name);
      } catch {
        // Storage may be unavailable in restricted browsing contexts.
      }
    },
  };
}

/**
 * Zustand `persist` storage that debounces the *object*, not its JSON.
 *
 * `createJSONStorage` stringifies the whole store on every state change and
 * only then hands the string to a debounced adapter — so a burst of edits paid
 * for a full serialisation each, and the debounce saved nothing on the CPU. This
 * keeps the latest state object and stringifies once, when the debounce fires
 * (or the tab is hidden). Same flush-on-hide guarantees as the string adapter.
 */
export function createDebouncedJSONStorage<S>(delayMs = 250): PersistStorage<S> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { name: string; value: StorageValue<S> } | null = null;

  const commit = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pending) return;
    const { name, value } = pending;
    pending = null;
    let json: string;
    try {
      json = JSON.stringify(value);
    } catch (err) {
      console.warn("[datebook] couldn't serialise the store:", err);
      return;
    }
    writeLocal(name, json);
  };

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", commit);
    window.addEventListener("beforeunload", commit);
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") commit();
    });
  }

  return {
    getItem: (name) => {
      if (pending?.name === name) return pending.value;
      try {
        const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(name);
        return raw ? (JSON.parse(raw) as StorageValue<S>) : null;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      pending = { name, value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(commit, delayMs);
    },
    removeItem: (name) => {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
      try {
        if (typeof localStorage !== "undefined") localStorage.removeItem(name);
      } catch {
        // Storage may be unavailable in restricted browsing contexts.
      }
    },
  };
}
