/** Debounced localStorage adapter for Zustand persist — reduces main-thread jank on bulk writes. */

type Pending = { name: string; value: string };

const flushers = new Set<() => void>();
let lifecycleBound = false;

function bindLifecycle() {
  if (lifecycleBound || typeof window === "undefined") return;
  lifecycleBound = true;
  const flushAll = () => {
    for (const fn of flushers) fn();
  };
  window.addEventListener("pagehide", flushAll);
  window.addEventListener("freeze", flushAll);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAll();
  });
}

export function createDebouncedStorage(delayMs = 250) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Pending | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending && typeof localStorage !== "undefined") {
      localStorage.setItem(pending.name, pending.value);
      pending = null;
    }
  };

  flushers.add(flush);
  bindLifecycle();

  return {
    getItem: (name: string) => {
      if (pending?.name === name) return pending.value;
      if (typeof localStorage === "undefined") return null;
      return localStorage.getItem(name);
    },
    setItem: (name: string, value: string) => {
      pending = { name, value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        flush();
      }, delayMs);
    },
    removeItem: (name: string) => {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
      if (typeof localStorage !== "undefined") localStorage.removeItem(name);
    },
    flush,
  };
}
