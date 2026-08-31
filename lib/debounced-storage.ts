/** Debounced localStorage adapter for Zustand persist — reduces main-thread jank on bulk writes. */
export function createDebouncedStorage(delayMs = 250) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { name: string; value: string } | null = null;

  return {
    getItem: (name: string) => {
      if (typeof localStorage === "undefined") return null;
      return localStorage.getItem(name);
    },
    setItem: (name: string, value: string) => {
      pending = { name, value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (pending && typeof localStorage !== "undefined") {
          localStorage.setItem(pending.name, pending.value);
        }
        pending = null;
        timer = null;
      }, delayMs);
    },
    removeItem: (name: string) => {
      if (timer) clearTimeout(timer);
      pending = null;
      if (typeof localStorage !== "undefined") localStorage.removeItem(name);
    },
  };
}
