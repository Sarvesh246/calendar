import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDebouncedJSONStorage,
  createDebouncedStorage,
  getStorageWriteFailed,
  subscribeStorageHealth,
} from "./debounced-storage";
import { describeSaveStatus } from "./save-status";

function stubStorage(opts: { full?: () => boolean } = {}) {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (opts.full?.()) throw new DOMException("full", "QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k: string) => map.delete(k),
  });
  return map;
}

describe("storage health", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports a failed write, notifies subscribers, and recovers on the next success", () => {
    let full = true;
    stubStorage({ full: () => full });
    const seen = vi.fn();
    const off = subscribeStorageHealth(seen);
    const storage = createDebouncedStorage(10);

    storage.setItem("k", "1");
    vi.advanceTimersByTime(10);
    expect(getStorageWriteFailed()).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);

    full = false;
    storage.setItem("k", "2");
    vi.advanceTimersByTime(10);
    expect(getStorageWriteFailed()).toBe(false);
    expect(seen).toHaveBeenCalledTimes(2);
    off();
  });

  it("the save pill copy outranks 'Saved' when storage failed", () => {
    const view = describeSaveStatus({
      mode: "local",
      syncStatus: "idle",
      online: true,
      queued: 0,
      storageFailed: true,
    });
    expect(view.tone).toBe("error");
    expect(view.title).toBe("Storage full");
    expect(view.transient).toBe(false);
  });
});

describe("createDebouncedJSONStorage", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stringifies once per debounce window, not once per change", () => {
    const map = stubStorage();
    const storage = createDebouncedJSONStorage<{ n: number }>(50);
    const spy = vi.spyOn(JSON, "stringify");
    for (let n = 0; n < 20; n++) storage.setItem("s", { state: { n }, version: 1 });
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(map.get("s")!)).toEqual({ state: { n: 19 }, version: 1 });
    spy.mockRestore();
  });

  it("reads back a queued value before it has been written, and the stored format is unchanged", () => {
    stubStorage();
    localStorage.setItem("s", JSON.stringify({ state: { n: 1 }, version: 8 }));
    const storage = createDebouncedJSONStorage<{ n: number }>(50);
    expect(storage.getItem("s")).toEqual({ state: { n: 1 }, version: 8 });
    storage.setItem("s", { state: { n: 2 }, version: 8 });
    expect(storage.getItem("s")).toEqual({ state: { n: 2 }, version: 8 });
  });
});
