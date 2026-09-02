import { describe, expect, it } from "vitest";
import {
  isDeleted,
  mergeTombstones,
  pruneTombstones,
  tombKey,
  TOMBSTONE_TTL_MS,
} from "./tombstones";

const T1 = "2026-09-01T10:00:00.000Z";
const T2 = "2026-09-01T12:00:00.000Z";

describe("mergeTombstones", () => {
  it("keeps the later delete for the same key", () => {
    const merged = mergeTombstones({ "item:a": T1 }, { "item:a": T2 });
    expect(merged["item:a"]).toBe(T2);
    expect(mergeTombstones({ "item:a": T2 }, { "item:a": T1 })["item:a"]).toBe(T2);
  });

  it("unions keys from both sides", () => {
    expect(Object.keys(mergeTombstones({ "item:a": T1 }, { "item:b": T2 })).sort()).toEqual([
      "item:a",
      "item:b",
    ]);
  });
});

describe("pruneTombstones", () => {
  it("drops entries past the retention window and keeps the rest", () => {
    const now = Date.parse(T2);
    const old = new Date(now - TOMBSTONE_TTL_MS - 1000).toISOString();
    const pruned = pruneTombstones({ "item:old": old, "item:new": T1 }, now);
    expect(pruned).toEqual({ "item:new": T1 });
  });
});

describe("isDeleted", () => {
  const row = { id: "a", createdAt: T1, updatedAt: T1 };

  it("is false with no tombstone", () => {
    expect(isDeleted({}, "item", row)).toBe(false);
  });

  it("is true when the delete is newer than the row", () => {
    expect(isDeleted({ [tombKey("item", "a")]: T2 }, "item", row)).toBe(true);
  });

  it("is true on an exact tie, so a same-instant delete still wins", () => {
    expect(isDeleted({ [tombKey("item", "a")]: T1 }, "item", row)).toBe(true);
  });

  it("is false once the row is edited after the delete — that's undo", () => {
    expect(isDeleted({ [tombKey("item", "a")]: T1 }, "item", { ...row, updatedAt: T2 })).toBe(
      false
    );
  });

  it("falls back to createdAt for rows written before edit times existed", () => {
    expect(isDeleted({ [tombKey("item", "a")]: T2 }, "item", { id: "a", createdAt: T1 })).toBe(
      true
    );
  });

  it("keys by entity kind, so ids can't collide across tables", () => {
    expect(isDeleted({ [tombKey("category", "a")]: T2 }, "item", row)).toBe(false);
  });
});
