import { describe, expect, it } from "vitest";
import { findOverlapGroups, overlapLabel, overlappingItemIds } from "./overlap";
import type { Item } from "./types";

const DAY = new Date(2026, 2, 3, 12, 0, 0);

function event(id: string, startHour: number, endHour: number, extra: Partial<Item> = {}): Item {
  const at = new Date(2026, 2, 3, startHour, 0, 0);
  const endAt = new Date(2026, 2, 3, endHour, 0, 0);
  return {
    id,
    categoryId: "c1",
    type: "event",
    title: id,
    at: at.toISOString(),
    endAt: endAt.toISOString(),
    createdAt: at.toISOString(),
    ...extra,
  } as Item;
}

describe("findOverlapGroups", () => {
  it("finds nothing in an empty day", () => {
    expect(findOverlapGroups([], DAY)).toEqual([]);
  });

  it("ignores events that merely follow each other", () => {
    const items = [event("a", 9, 10), event("b", 10, 11)];
    expect(findOverlapGroups(items, DAY)).toEqual([]);
  });

  it("pairs two genuinely concurrent events", () => {
    const groups = findOverlapGroups([event("a", 9, 11), event("b", 10, 12)], DAY);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(groups[0].startMin).toBe(9 * 60);
    expect(groups[0].endMin).toBe(12 * 60);
    expect(groups[0].overlapMin).toBe(60);
  });

  it("chains a three-way run into one group, not two pairs", () => {
    const groups = findOverlapGroups(
      [event("a", 9, 11), event("b", 10, 12), event("c", 11, 13)],
      DAY
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps separate collisions separate", () => {
    const groups = findOverlapGroups(
      [event("a", 9, 10.5 as number), event("b", 9, 10), event("c", 14, 16), event("d", 15, 17)],
      DAY
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].items.map((i) => i.id).sort()).toEqual(["a", "b"]);
    expect(groups[1].items.map((i) => i.id).sort()).toEqual(["c", "d"]);
  });

  it("ignores all-day items, which would otherwise collide with everything", () => {
    const items = [event("all", 0, 23, { allDay: true }), event("a", 9, 10)];
    expect(findOverlapGroups(items, DAY)).toEqual([]);
  });

  it("ignores assignments and tasks — a deadline is not a booking", () => {
    const items = [
      event("a", 9, 11),
      { ...event("t", 9, 10), type: "assignment", status: "todo" } as Item,
    ];
    expect(findOverlapGroups(items, DAY)).toEqual([]);
  });

  it("survives an unparseable date instead of throwing", () => {
    const bad = { ...event("bad", 9, 10), at: "not-a-date" } as Item;
    expect(() => findOverlapGroups([bad, event("a", 9, 10)], DAY)).not.toThrow();
  });

  it("measures only the minutes where two are actually live at once", () => {
    // a 9–12, b 10–10:30 → half an hour doubled up, not the whole span.
    const b = event("b", 10, 11);
    b.endAt = new Date(2026, 2, 3, 10, 30).toISOString();
    const [group] = findOverlapGroups([event("a", 9, 12), b], DAY);
    expect(group.overlapMin).toBe(30);
  });

  it("exposes the ids so a list can mark the rows", () => {
    const groups = findOverlapGroups([event("a", 9, 11), event("b", 10, 12)], DAY);
    expect(overlappingItemIds(groups)).toEqual(new Set(["a", "b"]));
  });

  it("labels a group by how many collide", () => {
    const groups = findOverlapGroups(
      [event("a", 9, 11), event("b", 10, 12), event("c", 10, 12)],
      DAY
    );
    expect(overlapLabel(groups[0])).toBe("3 events overlap");
  });
});
