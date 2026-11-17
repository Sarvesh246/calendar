import { describe, expect, it } from "vitest";
import { epoch, watchBatch, watchItem, watchText } from "./watch";

describe("watch protocol", () => {
  it("rejects arbitrary mutations and oversized outboxes", () => {
    const op = {
      id: crypto.randomUUID(),
      itemId: crypto.randomUUID(),
      action: "status",
      value: "done",
      base: 0,
      changedAt: 1794956400,
    };
    expect(watchBatch.safeParse({ changes: [op] }).success).toBe(true);
    expect(watchBatch.safeParse({ changes: [{ ...op, action: "delete" }] }).success).toBe(false);
    expect(watchBatch.safeParse({ changes: Array(31).fill(op) }).success).toBe(false);
    expect(watchBatch.safeParse({ changes: [{ ...op, itemId: "other-account" }] }).success).toBe(
      false,
    );
    expect(watchBatch.safeParse({ changes: [{ ...op, value: "erase" }] }).success).toBe(false);
    expect(
      watchBatch.safeParse({ changes: [{ ...op, action: "reschedule", value: "tomorrow" }] })
        .success,
    ).toBe(false);
    expect(
      watchBatch.safeParse({ changes: [{ ...op, action: "reminder", value: "-1" }] }).success,
    ).toBe(false);
  });
  it("keeps completed work done and maps nullable fields safely", () => {
    const item = watchItem(
      {
        id: "a",
        title: "<p>Essay &amp; notes</p>",
        status: "done",
        at: "2026-11-17T18:00:00Z",
        category_id: "c",
        subtasks: null,
      },
      new Map([["c", "History"]]),
    );
    expect(item.title).toBe("Essay & notes");
    expect(item.status).toBe("done");
    expect(item.class).toBe("History");
    expect(item.description).toBe("");
    expect(item.subtasks).toEqual([]);
    expect(item.at).toBe(1794938400);
    expect(epoch(null)).toBe(0);
  });
  it("bounds imported descriptions for watch memory", () => {
    expect(watchText("x".repeat(3000), 1200)).toHaveLength(1200);
  });
});
