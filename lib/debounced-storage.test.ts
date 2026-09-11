import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createDebouncedStorage } from "./debounced-storage";

function mockLocalStorage() {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
  vi.stubGlobal("localStorage", storage);
  return storage;
}

describe("createDebouncedStorage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockLocalStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("debounces writes to localStorage", () => {
    const storage = createDebouncedStorage(200);
    storage.setItem("test", "a");
    storage.setItem("test", "b");
    expect(localStorage.getItem("test")).toBeNull();
    vi.advanceTimersByTime(199);
    expect(localStorage.getItem("test")).toBeNull();
    vi.advanceTimersByTime(1);
    expect(localStorage.getItem("test")).toBe("b");
  });

  it("removeItem clears pending write", () => {
    const storage = createDebouncedStorage(200);
    storage.setItem("test", "a");
    storage.removeItem("test");
    vi.advanceTimersByTime(300);
    expect(localStorage.getItem("test")).toBeNull();
  });

  it("rehydrates the latest pending edit instead of older disk data", () => {
    localStorage.setItem("test", "old");
    const storage = createDebouncedStorage(200);
    storage.setItem("test", "edited");
    expect(storage.getItem("test")).toBe("edited");
    vi.advanceTimersByTime(200);
    expect(storage.getItem("test")).toBe("edited");
  });

  it("keeps restricted storage from crashing hydration or reset", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    });
    const storage = createDebouncedStorage();
    expect(storage.getItem("test")).toBeNull();
    expect(() => storage.removeItem("test")).not.toThrow();
  });
});
