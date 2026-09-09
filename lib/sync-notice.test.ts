import { describe, expect, it } from "vitest";
import type { Item } from "./types";
import { rowToItem, toItemRow } from "./db-sync";
import {
  decideRemoteItemNotice,
  dismissSyncNotice,
  isOwnWriteEcho,
  itemNoticeFingerprint,
  mergeNoticeBatch,
  type NoticeDraft,
  type SyncNotice,
} from "./sync-notice";

function item(over: Partial<Item> = {}): Item {
  return {
    id: "item-1",
    categoryId: "cat-1",
    type: "assignment",
    title: "Essay",
    at: "2026-09-10T17:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-09T12:00:00.000Z",
    ...over,
  };
}

describe("itemNoticeFingerprint", () => {
  it("treats mapper noise as the same item", () => {
    const local = item({ allDay: false, description: undefined, status: "todo" });
    const echo = item({ status: "todo" });
    delete (echo as { allDay?: boolean }).allDay;
    expect(itemNoticeFingerprint(local)).toBe(itemNoticeFingerprint(echo));
  });

  it("changes when a user-visible field changes", () => {
    expect(itemNoticeFingerprint(item({ title: "Essay v2" }))).not.toBe(
      itemNoticeFingerprint(item())
    );
    expect(itemNoticeFingerprint(item({ status: "done" }))).not.toBe(
      itemNoticeFingerprint(item({ status: "todo" }))
    );
  });

  it("normalizes equivalent timestamps", () => {
    const a = item({ at: "2026-09-10T17:00:00.000Z" });
    const b = item({ at: "2026-09-10T17:00:00Z" });
    expect(itemNoticeFingerprint(a)).toBe(itemNoticeFingerprint(b));
  });
});

describe("isOwnWriteEcho", () => {
  it("matches the stamp this device just wrote", () => {
    expect(isOwnWriteEcho("2026-09-09T12:00:00.000Z", "2026-09-09T12:00:00.000Z")).toBe(
      true
    );
  });

  it("tolerates a millisecond or two of postgres rounding", () => {
    expect(isOwnWriteEcho("2026-09-09T12:00:00.012Z", "2026-09-09T12:00:00.000Z")).toBe(
      true
    );
  });

  it("does not treat a later other-device write as an echo", () => {
    expect(isOwnWriteEcho("2026-09-09T12:00:05.000Z", "2026-09-09T12:00:00.000Z")).toBe(
      false
    );
  });

  it("is false when this device never wrote the row", () => {
    expect(isOwnWriteEcho("2026-09-09T12:00:00.000Z", undefined)).toBe(false);
  });
});

describe("decideRemoteItemNotice", () => {
  const prev = item();

  it("stays quiet for the echo of our own write, even when JSON would differ", () => {
    const remote = item({ allDay: undefined, updatedAt: prev.updatedAt });
    expect(
      decideRemoteItemNotice({
        prev,
        remote,
        lastWrittenAt: prev.updatedAt,
        editedHereRecently: true,
      })
    ).toBeNull();
  });

  it("stays quiet when the remote stamp is not newer than what's on screen", () => {
    const remote = item({
      title: "Essay (stale)",
      updatedAt: "2026-09-09T11:00:00.000Z",
    });
    expect(
      decideRemoteItemNotice({
        prev,
        remote,
        editedHereRecently: false,
      })
    ).toBeNull();
  });

  it("announces a newer other-device edit on a device that was not editing", () => {
    const remote = item({
      title: "Essay rescheduled",
      updatedAt: "2026-09-09T12:01:00.000Z",
    });
    expect(
      decideRemoteItemNotice({
        prev,
        remote,
        editedHereRecently: false,
      })
    ).toEqual({
      itemId: "item-1",
      title: "Essay rescheduled",
      kind: "remote",
    });
  });

  it("marks a real overwrite as a conflict when this device was editing", () => {
    const remote = item({
      title: "Essay rescheduled",
      updatedAt: "2026-09-09T12:01:00.000Z",
    });
    expect(
      decideRemoteItemNotice({
        prev,
        remote,
        lastWrittenAt: prev.updatedAt,
        editedHereRecently: true,
      })
    ).toEqual({
      itemId: "item-1",
      title: "Essay rescheduled",
      kind: "conflict",
    });
  });

  it("does not announce mapper-only differences on a newer stamp", () => {
    const remote = item({
      updatedAt: "2026-09-09T12:01:00.000Z",
    });
    expect(
      decideRemoteItemNotice({
        prev: item({ allDay: false }),
        remote,
        editedHereRecently: false,
      })
    ).toBeNull();
  });

  it("does not toast the postgres round-trip of a write made on this device", () => {
    const prev = item({
      allDay: false,
      status: "todo",
      description: "",
      updatedAt: "2026-09-09T12:00:00.000Z",
    });
    const remote = rowToItem(toItemRow(prev, "user-1"));
    expect(
      decideRemoteItemNotice({
        prev,
        remote,
        lastWrittenAt: prev.updatedAt,
        editedHereRecently: true,
      })
    ).toBeNull();
  });
});

describe("mergeNoticeBatch", () => {
  const ids = { n: 0, make: () => `id-${++ids.n}` };

  it("replaces an existing card for the same item instead of stacking another", () => {
    ids.n = 0;
    const first = mergeNoticeBatch(
      [],
      [{ itemId: "a", title: "A", kind: "remote" }],
      ids.make
    );
    const next = mergeNoticeBatch(
      first,
      [{ itemId: "a", title: "A v2", kind: "remote" }],
      ids.make
    );
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe(first[0].id);
    expect(next[0].title).toBe("A v2");
    expect(next[0].rev).toBe(1);
  });

  it("stacks different items, newest first, capped at three", () => {
    ids.n = 0;
    const drafts: NoticeDraft[] = [
      { itemId: "a", title: "A", kind: "remote" },
      { itemId: "b", title: "B", kind: "remote" },
      { itemId: "c", title: "C", kind: "remote" },
      { itemId: "d", title: "D", kind: "remote" },
    ];
    // Four in one batch but under the bulk threshold? 4 remotes === bulk.
    // Three should stack.
    const three = mergeNoticeBatch([], drafts.slice(0, 3), ids.make);
    expect(three.map((n) => n.itemId)).toEqual(["c", "b", "a"]);

    const capped = mergeNoticeBatch(three, [drafts[3]!], ids.make);
    expect(capped).toHaveLength(3);
    expect(capped.map((n) => n.itemId)).toEqual(["d", "c", "b"]);
  });

  it("collapses a flood of remotes into one bulk card and keeps conflicts", () => {
    ids.n = 0;
    const flood: NoticeDraft[] = [
      { itemId: "a", title: "A", kind: "remote" },
      { itemId: "b", title: "B", kind: "remote" },
      { itemId: "c", title: "C", kind: "remote" },
      { itemId: "d", title: "D", kind: "remote" },
      { itemId: "e", title: "E", kind: "conflict" },
    ];
    const next = mergeNoticeBatch([], flood, ids.make);
    expect(next.some((n) => n.kind === "bulk")).toBe(true);
    expect(next.some((n) => n.kind === "conflict" && n.itemId === "e")).toBe(true);
    expect(next.filter((n) => n.kind === "remote")).toHaveLength(0);
  });

  it("dismisses a single card by id", () => {
    const stack: SyncNotice[] = [
      { id: "1", itemId: "a", title: "A", kind: "remote", rev: 0 },
      { id: "2", itemId: "b", title: "B", kind: "remote", rev: 0 },
    ];
    expect(dismissSyncNotice(stack, "1").map((n) => n.id)).toEqual(["2"]);
  });
});
