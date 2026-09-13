import { describe, expect, it } from "vitest";
import {
  classChipLabel,
  dayChipLabel,
  onDay,
  reminderChipLabel,
  resolveComposer,
  type ComposerParse,
} from "./composer-fields";
import type { Category } from "./types";

const cats: Category[] = [
  { id: "bio", name: "BIOL 111", color: "#0f0" },
  { id: "cs", name: "CSCE 121", color: "#00f" },
];

const NO_CONTEXT = { dateKey: null, categoryId: null, defaultReminderMinutes: null };

function parse(at: Date, confidence: Partial<ComposerParse["confidence"]> = {}, rest: Partial<ComposerParse> = {}): ComposerParse {
  return {
    at,
    confidence: { date: false, category: false, reminder: false, ...confidence },
    ...rest,
  };
}

describe("resolveComposer — day", () => {
  it("falls back to the parse when nothing else knows better", () => {
    const at = new Date(2026, 2, 3, 9, 0);
    const r = resolveComposer(parse(at), NO_CONTEXT, {});
    expect(r.date.value).toEqual(at);
    expect(r.date.source).toBe("default");
  });

  it("uses the day the add started from, keeping the parsed time", () => {
    const at = new Date(2026, 2, 3, 9, 30);
    const r = resolveComposer(parse(at), { ...NO_CONTEXT, dateKey: "2026-03-14" }, {});
    expect(r.date.source).toBe("context");
    expect(r.date.value.getFullYear()).toBe(2026);
    expect(r.date.value.getMonth()).toBe(2);
    expect(r.date.value.getDate()).toBe(14);
    expect(r.date.value.getHours()).toBe(9);
    expect(r.date.value.getMinutes()).toBe(30);
  });

  it("lets a typed date stand", () => {
    const at = new Date(2026, 2, 20, 15, 0);
    const r = resolveComposer(parse(at, { date: true }), NO_CONTEXT, {});
    expect(r.date.source).toBe("typed");
    expect(r.date.value).toEqual(at);
  });

  it("lets the chip override beat everything, keeping the time", () => {
    const at = new Date(2026, 2, 20, 15, 45);
    const r = resolveComposer(
      parse(at, { date: true }),
      { ...NO_CONTEXT, dateKey: "2026-03-14" },
      { dateKey: "2026-04-01" }
    );
    expect(r.date.source).toBe("override");
    expect(r.date.value.getMonth()).toBe(3);
    expect(r.date.value.getDate()).toBe(1);
    expect(r.date.value.getHours()).toBe(15);
    expect(r.date.value.getMinutes()).toBe(45);
  });

  it("ignores an unparseable override rather than producing an invalid date", () => {
    const at = new Date(2026, 2, 3, 9, 0);
    const r = resolveComposer(parse(at), NO_CONTEXT, { dateKey: "not-a-day" });
    expect(Number.isNaN(r.date.value.getTime())).toBe(false);
    expect(r.date.source).toBe("default");
  });
});

describe("resolveComposer — class", () => {
  it("prefers a typed class", () => {
    const r = resolveComposer(
      parse(new Date(), { category: true }, { categoryId: "bio" }),
      { ...NO_CONTEXT, categoryId: "cs" },
      {}
    );
    expect(r.categoryId.value).toBe("bio");
    expect(r.categoryId.source).toBe("typed");
  });

  it("falls back to the class you were working inside", () => {
    const r = resolveComposer(parse(new Date()), { ...NO_CONTEXT, categoryId: "cs" }, {});
    expect(r.categoryId.value).toBe("cs");
    expect(r.categoryId.source).toBe("context");
  });

  it("lets the chip override beat both", () => {
    const r = resolveComposer(
      parse(new Date(), { category: true }, { categoryId: "bio" }),
      { ...NO_CONTEXT, categoryId: "cs" },
      { categoryId: "cs" }
    );
    expect(r.categoryId.value).toBe("cs");
    expect(r.categoryId.source).toBe("override");
  });

  it("names the class the item would actually land in", () => {
    // "No class" followed by the item appearing under the first class is the
    // chip being wrong about the one thing it is for.
    const r = resolveComposer(parse(new Date()), { ...NO_CONTEXT, fallbackCategoryId: "bio" }, {});
    expect(r.categoryId.value).toBe("bio");
    expect(r.categoryId.source).toBe("default");
  });

  it("treats an empty override as a deliberate 'no class'", () => {
    const r = resolveComposer(
      parse(new Date(), { category: true }, { categoryId: "bio" }),
      NO_CONTEXT,
      { categoryId: "" }
    );
    expect(r.categoryId.value).toBe("");
    expect(r.categoryId.source).toBe("override");
  });
});

describe("resolveComposer — reminder", () => {
  it("uses the app default when nothing says otherwise", () => {
    const r = resolveComposer(parse(new Date()), { ...NO_CONTEXT, defaultReminderMinutes: 60 }, {});
    expect(r.reminderMinutes.value).toBe(60);
    expect(r.reminderMinutes.source).toBe("default");
  });

  it("prefers a reminder written into the sentence", () => {
    const r = resolveComposer(
      parse(new Date(), { reminder: true }, { reminderMinutesBefore: 15 }),
      { ...NO_CONTEXT, defaultReminderMinutes: 60 },
      {}
    );
    expect(r.reminderMinutes.value).toBe(15);
    expect(r.reminderMinutes.source).toBe("typed");
  });

  it("keeps an explicit 'none' instead of falling back to the default", () => {
    // 0 is falsy, which is exactly how "no reminder" used to become "1 day
    // before" on the way through a truthiness check.
    const r = resolveComposer(
      parse(new Date(), { reminder: true }, { reminderMinutesBefore: 15 }),
      { ...NO_CONTEXT, defaultReminderMinutes: 60 },
      { reminderMinutes: 0 }
    );
    expect(r.reminderMinutes.value).toBe(null);
    expect(r.reminderMinutes.source).toBe("override");
  });
});

describe("onDay", () => {
  it("keeps the clock time across a move", () => {
    const at = new Date(2026, 2, 3, 23, 45);
    const moved = onDay(at, new Date(2026, 10, 2, 0, 0));
    expect(moved.getHours()).toBe(23);
    expect(moved.getMinutes()).toBe(45);
    expect(moved.getDate()).toBe(2);
  });
});

describe("chip labels", () => {
  it("names today and tomorrow rather than dating them", () => {
    const now = new Date(2026, 2, 3, 12, 0);
    expect(dayChipLabel(new Date(2026, 2, 3, 8, 0), now)).toBe("Today");
    expect(dayChipLabel(new Date(2026, 2, 4, 8, 0), now)).toBe("Tomorrow");
    expect(dayChipLabel(new Date(2026, 2, 2, 8, 0), now)).toBe("Yesterday");
    expect(dayChipLabel(new Date(2026, 2, 14, 8, 0), now)).toBe("Sat 14 Mar");
  });

  it("names the class, or says there isn't one", () => {
    expect(classChipLabel("bio", cats)).toBe("BIOL 111");
    expect(classChipLabel(undefined, cats)).toBe("No class");
    expect(classChipLabel("deleted", cats)).toBe("No class");
  });

  it("says reminders in the units people use", () => {
    expect(reminderChipLabel(null)).toBe("No reminder");
    expect(reminderChipLabel(0)).toBe("At the time");
    expect(reminderChipLabel(10)).toBe("10 min before");
    expect(reminderChipLabel(60)).toBe("1 hour before");
    expect(reminderChipLabel(120)).toBe("2 hours before");
    expect(reminderChipLabel(1440)).toBe("1 day before");
    expect(reminderChipLabel(2880)).toBe("2 days before");
    expect(reminderChipLabel(90)).toBe("90 min before");
  });
});
