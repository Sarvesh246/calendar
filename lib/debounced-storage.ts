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
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(pending.name, pending.value);
      } catch (err) {
        // Quota exceeded / private mode. Losing the write is survivable; a
        // thrown error inside persist's middleware is not.
        console.warn("[datebook] couldn't write to localStorage:", err);
      }
    }
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
      if (typeof localStorage === "undefined") return null;
      return localStorage.getItem(name);
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
      if (typeof localStorage !== "undefined") localStorage.removeItem(name);
    },
  };
}
