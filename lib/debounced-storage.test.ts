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

  it("flush writes a pending value immediately so a backgrounded PWA cannot drop it", () => {
    const storage = createDebouncedStorage(5000);
    storage.setItem("test", "ember");
    expect(localStorage.getItem("test")).toBeNull();
    storage.flush();
    expect(localStorage.getItem("test")).toBe("ember");
  });

  it("getItem returns a pending write before it hits localStorage", () => {
    const storage = createDebouncedStorage(5000);
    storage.setItem("test", "noir");
    expect(storage.getItem("test")).toBe("noir");
    expect(localStorage.getItem("test")).toBeNull();
  });

  it("removeItem clears pending write", () => {
    const storage = createDebouncedStorage(200);
    storage.setItem("test", "a");
    storage.removeItem("test");
    vi.advanceTimersByTime(300);
    expect(localStorage.getItem("test")).toBeNull();
  });
});
