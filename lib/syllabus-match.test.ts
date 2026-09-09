import { beforeEach, describe, expect, it } from "vitest";
import { wallTimeInZoneToIso } from "./date-utils";
import { applySyllabusImportToSnapshot, type SyllabusSnapshot } from "./syllabus-import";
import {
  collapseCrossSourceDuplicates,
  groupSyllabusMatches,
  isSyllabusSource,
  matchSyllabusItems,
  normalizeSyllabusTitle,
  resolveSyllabusCourse,
  syllabusSourceUid,
  syllabusSourceUrl,
  syllabusTitleScore,
  summarizeSyllabusMatches,
  type SyllabusDraft,
} from "./syllabus-match";
import { tombKey } from "./tombstones";
import { useDatebookStore } from "./store";
import type { Category, ImportSource, Item } from "./types";

const TZ = "America/Chicago";
const DAY = "2026-09-10";
const AT = wallTimeInZoneToIso(DAY, 23, 59, TZ);

const ENGL: Category = { id: "engl", name: "ENGL 101", color: "#007AFF" };
const ENGR: Category = { id: "engr", name: "ENGR-102:201,204", color: "#5856D6" };

function draft(over: Partial<SyllabusDraft> & { title: string }): SyllabusDraft {
  return {
    at: AT,
    type: "assignment",
    ...over,
  };
}

function item(over: Partial<Item> & { id: string; title: string }): Item {
  return {
    categoryId: "engl",
    type: "assignment",
    at: AT,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

function matchOf(title: string, existing: Item[], extra: SyllabusDraft[] = []) {
  return matchSyllabusItems([draft({ title }), ...extra], existing, {
    timeZone: TZ,
    categoryId: "engl",
  });
}

describe("normalizeSyllabusTitle", () => {
  it("expands hw / h.w. / pset / ps and strips course, filler, punctuation", () => {
    expect(normalizeSyllabusTitle("HW 3")).toBe("homework 3");
    expect(normalizeSyllabusTitle("hw3")).toBe("homework 3");
    expect(normalizeSyllabusTitle("h.w. 2")).toBe("homework 2");
    expect(normalizeSyllabusTitle("Pset 1")).toBe("problem set 1");
    expect(normalizeSyllabusTitle("PS 4")).toBe("problem set 4");
    expect(normalizeSyllabusTitle("ps4")).toBe("problem set 4");
    expect(normalizeSyllabusTitle("Essay 1 draft [ENGL 101]")).toBe("essay 1 draft");
    expect(normalizeSyllabusTitle("Homework 3 due")).toBe("homework 3");
    expect(normalizeSyllabusTitle("Submit HW 3")).toBe("homework 3");
    expect(normalizeSyllabusTitle("Homework #3 — Linked Lists")).toBe("homework 3 linked lists");
  });
});

describe("matchSyllabusItems — name variants", () => {
  it("matches HW 3 to Homework 3: Linked Lists on the same day", () => {
    const existing = [item({ id: "c1", title: "Homework 3: Linked Lists" })];
    const [m] = matchOf("HW 3", existing);
    expect(m.verdict).toBe("matched");
    expect(m.existing?.id).toBe("c1");
    expect(m.score).toBeGreaterThanOrEqual(0.72);
  });

  it("matches h.w. / pset / ps variants to the long form", () => {
    expect(matchOf("h.w. 2", [item({ id: "a", title: "Homework 2" })])[0].verdict).toBe("matched");
    expect(matchOf("Pset 1", [item({ id: "b", title: "Problem Set 1" })])[0].verdict).toBe("matched");
    expect(matchOf("PS 4", [item({ id: "c", title: "Problem Set 4: Recursion" })])[0].verdict).toBe(
      "matched"
    );
  });

  it("treats an event with the same title as a match (Canvas typing)", () => {
    const existing = [item({ id: "e1", title: "Midterm", type: "event" })];
    expect(matchOf("Midterm", existing)[0].verdict).toBe("matched");
  });
});

describe("matchSyllabusItems — assignment number veto", () => {
  it("does not match Homework 3 to Homework 4 on the same day", () => {
    const existing = [item({ id: "hw4", title: "Homework 4" })];
    const [m] = matchOf("Homework 3", existing);
    expect(m.verdict).toBe("new");
    expect(m.existing).toBeUndefined();
  });

  it("does not match HW 3 Linked Lists to HW 4 Linked Lists", () => {
    const existing = [item({ id: "hw4", title: "HW 4: Linked Lists" })];
    const [m] = matchOf("HW 3: Linked Lists", existing);
    expect(m.verdict).toBe("new");
    expect(syllabusTitleScore("HW 3: Linked Lists", "HW 4: Linked Lists")).toBeGreaterThan(0.7);
  });
});

describe("matchSyllabusItems — same-day different work", () => {
  it("does not match a quiz to homework due the same day", () => {
    const existing = [item({ id: "q", title: "Quiz 1" })];
    const [m] = matchOf("Homework 3", existing);
    expect(m.verdict).toBe("new");
  });

  it("still matches the quiz when that is the extracted row", () => {
    const existing = [
      item({ id: "q", title: "Quiz 1" }),
      item({ id: "h", title: "Homework 3" }),
    ];
    const [quiz, hw] = matchSyllabusItems(
      [draft({ title: "Quiz 1" }), draft({ title: "HW 3" })],
      existing,
      { timeZone: TZ, categoryId: "engl" }
    );
    expect(quiz.existing?.id).toBe("q");
    expect(hw.existing?.id).toBe("h");
    expect(quiz.verdict).toBe("matched");
    expect(hw.verdict).toBe("matched");
  });
});

describe("matchSyllabusItems — timezone edge", () => {
  const late = wallTimeInZoneToIso(DAY, 23, 59, TZ);
  const nextMidnight = wallTimeInZoneToIso("2026-09-11", 0, 0, TZ);

  it("matches equal normalized titles one calendar day apart", () => {
    const existing = [item({ id: "m", title: "Midterm Exam", at: nextMidnight })];
    const [m] = matchSyllabusItems([draft({ title: "Midterm Exam", at: late })], existing, {
      timeZone: TZ,
      categoryId: "engl",
    });
    expect(m.verdict).toBe("matched");
    expect(m.existing?.id).toBe("m");
  });

  it("does not use the one-day window when titles only look similar", () => {
    const existing = [item({ id: "m", title: "Midterm Exam", at: nextMidnight })];
    const [m] = matchSyllabusItems([draft({ title: "Quiz 2", at: late })], existing, {
      timeZone: TZ,
      categoryId: "engl",
    });
    expect(m.verdict).toBe("new");
  });
});

describe("matchSyllabusItems — scoring bands and one-to-one", () => {
  it("puts a middling title in check-these, not a confident match", () => {
    const existing = [item({ id: "q", title: "Quiz 1 review sheet" })];
    const [m] = matchOf("Quiz 1 extra", existing);
    expect(m.verdict).toBe("uncertain");
    expect(m.score).toBeGreaterThanOrEqual(0.5);
    expect(m.score).toBeLessThan(0.72);
  });

  it("claims each existing item at most once (greedy highest score)", () => {
    const existing = [item({ id: "hw", title: "Homework 3: Linked Lists" })];
    const [a, b] = matchSyllabusItems(
      [draft({ title: "Homework 3: Linked Lists" }), draft({ title: "HW 3" })],
      existing,
      { timeZone: TZ, categoryId: "engl" }
    );
    expect(a.verdict).toBe("matched");
    expect(a.existing?.id).toBe("hw");
    // Duplicate extract of the same work — already on the calendar, not a second row.
    expect(b.verdict).toBe("matched");
    expect(b.existing?.id).toBe("hw");
  });

  it("summarizes preview groups", () => {
    const existing = [item({ id: "hw", title: "Homework 3" })];
    const matches = matchSyllabusItems(
      [draft({ title: "HW 3" }), draft({ title: "Quiz 1 extra" }), draft({ title: "Final paper" })],
      existing,
      { timeZone: TZ, categoryId: "engl" }
    );
    const groups = groupSyllabusMatches(matches);
    expect(groups.already).toHaveLength(1);
    expect(groups.newItems.map((m) => m.draft.title)).toContain("Final paper");
    const summary = summarizeSyllabusMatches(matches);
    expect(summary.alreadyCount + summary.newCount + summary.checkCount).toBe(3);
  });
});

describe("resolveSyllabusCourse", () => {
  const categories = [ENGL, ENGR];

  it("files a shared drop by course code onto ENGR-102", () => {
    const resolved = resolveSyllabusCourse({
      categories,
      courseName: "Intro to Engineering",
      courseCode: "ENGR 102",
    });
    expect(resolved).toEqual({ status: "matched", categoryId: "engr" });
  });

  it("files by categoryKey when the name already matches", () => {
    const resolved = resolveSyllabusCourse({ categories, courseName: "engl 101" });
    expect(resolved).toEqual({ status: "matched", categoryId: "engl" });
  });

  it("warns when a forced category clearly disagrees with the extracted code", () => {
    const resolved = resolveSyllabusCourse({
      categories,
      forceCategoryId: "engl",
      courseName: "Calculus I",
      courseCode: "MATH 151",
    });
    expect(resolved.status).toBe("forced");
    if (resolved.status !== "forced") return;
    expect(resolved.categoryId).toBe("engl");
    expect(resolved.warning).toMatch(/MATH/i);
  });

  it("does not warn when the forced class matches the extracted code", () => {
    const resolved = resolveSyllabusCourse({
      categories,
      forceCategoryId: "engl",
      courseCode: "ENGL-101",
    });
    expect(resolved).toEqual({ status: "forced", categoryId: "engl" });
  });

  it("asks the apply path to mint when nothing matches", () => {
    const resolved = resolveSyllabusCourse({
      categories,
      courseName: "Biology 111",
      courseCode: "BIOL 111",
    });
    expect(resolved).toEqual({ status: "create", name: "Biology 111" });
  });
});

describe("collapseCrossSourceDuplicates — calendar after syllabus", () => {
  const syllabusSrc: ImportSource = {
    id: "src-syl",
    url: syllabusSourceUrl("ENGL 101"),
    name: "engl101.pdf",
    addedAt: "2026-09-01T00:00:00.000Z",
    lastSyncedAt: "2026-09-01T00:00:00.000Z",
    itemCount: 1,
  };
  const feedSrc: ImportSource = {
    id: "src-feed",
    url: "https://canvas.example/feed.ics",
    name: "Canvas",
    addedAt: "2026-09-02T00:00:00.000Z",
    lastSyncedAt: "2026-09-02T00:00:00.000Z",
    itemCount: 1,
  };

  it("keeps the feed row, folds syllabus status, and tombstones the syllabus copy", () => {
    const syl = item({
      id: "syl-hw",
      title: "HW 3",
      sourceId: "src-syl",
      sourceUid: syllabusSourceUid("HW 3", AT, TZ),
      status: "done",
      statusAt: "2026-09-09T12:00:00.000Z",
      completedAt: "2026-09-09T12:00:00.000Z",
      description: "Linked lists writeup",
    });
    const feed = item({
      id: "canvas-hw",
      title: "Homework 3: Linked Lists",
      sourceId: "src-feed",
      sourceUid: "canvas-uid-hw3",
      url: "https://canvas.example/assignments/3",
      status: "todo",
    });
    const { items, dropped } = collapseCrossSourceDuplicates(
      [syl, feed],
      [syllabusSrc, feedSrc],
      TZ,
      "2026-09-10T18:00:00.000Z"
    );
    expect(dropped).toEqual(["syl-hw"]);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("canvas-hw");
    expect(items[0].sourceUid).toBe("canvas-uid-hw3");
    expect(items[0].url).toBe("https://canvas.example/assignments/3");
    expect(items[0].title).toBe("Homework 3: Linked Lists");
    expect(items[0].status).toBe("done");
    expect(items[0].description).toBe("Linked lists writeup");
  });

  it("does not collapse an uncertain title pair", () => {
    const syl = item({
      id: "syl-q",
      title: "Quiz 1 extra",
      sourceId: "src-syl",
      sourceUid: syllabusSourceUid("Quiz 1 extra", AT, TZ),
    });
    const feed = item({
      id: "canvas-q",
      title: "Quiz 1 review sheet",
      sourceId: "src-feed",
      sourceUid: "canvas-uid-q1",
    });
    const { items, dropped } = collapseCrossSourceDuplicates([syl, feed], [syllabusSrc, feedSrc], TZ);
    expect(dropped).toEqual([]);
    expect(items).toHaveLength(2);
  });

  it("does not fold two classes' Homework 3 together", () => {
    const syl = item({
      id: "syl-hw",
      title: "HW 3",
      categoryId: "engl",
      sourceId: "src-syl",
      sourceUid: syllabusSourceUid("HW 3", AT, TZ),
    });
    const feed = item({
      id: "canvas-hw",
      title: "Homework 3: Linked Lists",
      categoryId: "engr",
      sourceId: "src-feed",
      sourceUid: "canvas-uid-hw3",
    });
    const { dropped } = collapseCrossSourceDuplicates([syl, feed], [syllabusSrc, feedSrc], TZ);
    expect(dropped).toEqual([]);
  });
});

describe("applySyllabusImportToSnapshot", () => {
  const now = "2026-09-10T18:00:00.000Z";
  let n = 0;
  const id = () => `id-${++n}`;

  function snap(over: Partial<SyllabusSnapshot> = {}): SyllabusSnapshot {
    return {
      items: [],
      categories: [ENGL],
      importSources: [],
      deletions: {},
      ...over,
    };
  }

  beforeEach(() => {
    n = 0;
  });

  it("creates new rows with syl: UIDs and a syllabus:// source", () => {
    const { snapshot, result } = applySyllabusImportToSnapshot(
      snap({}),
      {
        drafts: [draft({ title: "HW 3" }), draft({ title: "Quiz 1" })],
        timeZone: TZ,
        forceCategoryId: "engl",
        fileName: "engl101.pdf",
      },
      { now, id }
    );
    expect(result.added).toBe(2);
    expect(snapshot.importSources).toHaveLength(1);
    expect(isSyllabusSource(snapshot.importSources[0])).toBe(true);
    expect(snapshot.importSources[0].url).toBe(syllabusSourceUrl("ENGL 101"));
    expect(snapshot.items.every((i) => i.sourceUid?.startsWith("syl:"))).toBe(true);
    expect(snapshot.items.every((i) => i.categoryId === "engl")).toBe(true);
  });

  it("does not steal a Canvas sourceId/sourceUid on a match", () => {
    const canvas = item({
      id: "canvas-hw",
      title: "Homework 3: Linked Lists",
      sourceId: "src-feed",
      sourceUid: "canvas-uid-hw3",
      url: "https://canvas.example/assignments/3",
      status: "doing",
    });
    const { snapshot, result } = applySyllabusImportToSnapshot(
      snap({
        items: [canvas],
        importSources: [
          {
            id: "src-feed",
            url: "https://canvas.example/feed.ics",
            name: "Canvas",
            addedAt: now,
            lastSyncedAt: now,
            itemCount: 1,
          },
        ],
      }),
      {
        drafts: [draft({ title: "HW 3", notes: "Ch. 4–5" })],
        timeZone: TZ,
        forceCategoryId: "engl",
      },
      { now, id }
    );
    expect(result.added).toBe(0);
    expect(result.matched).toBe(1);
    expect(snapshot.items).toHaveLength(1);
    const kept = snapshot.items[0];
    expect(kept.id).toBe("canvas-hw");
    expect(kept.sourceId).toBe("src-feed");
    expect(kept.sourceUid).toBe("canvas-uid-hw3");
    expect(kept.title).toBe("Homework 3: Linked Lists");
    expect(kept.url).toBe("https://canvas.example/assignments/3");
    expect(kept.status).toBe("doing");
    expect(kept.description).toBe("Ch. 4–5");
  });

  it("rematches a re-import by sourceUid and does not prune missed rows", () => {
    const first = applySyllabusImportToSnapshot(
      snap({}),
      {
        drafts: [draft({ title: "HW 3" }), draft({ title: "Quiz 1" })],
        timeZone: TZ,
        forceCategoryId: "engl",
      },
      { now, id }
    );
    expect(first.result.added).toBe(2);
    const second = applySyllabusImportToSnapshot(first.snapshot, {
      drafts: [draft({ title: "Homework 3" })],
      timeZone: TZ,
      forceCategoryId: "engl",
    });
    expect(second.result.added).toBe(0);
    expect(second.snapshot.items).toHaveLength(2);
    expect(second.snapshot.items.some((i) => /quiz/i.test(i.title))).toBe(true);
  });

  it("mints a category when the shared drop matches nothing", () => {
    const { snapshot, result } = applySyllabusImportToSnapshot(
      snap({}),
      {
        drafts: [draft({ title: "Lab 1" })],
        timeZone: TZ,
        courseName: "Biology 111",
        courseCode: "BIOL 111",
      },
      { now, id }
    );
    expect(result.added).toBe(1);
    expect(snapshot.categories.some((c) => c.name === "Biology 111")).toBe(true);
    expect(snapshot.items[0].categoryId).toBe(result.categoryId);
  });
});

describe("store applyImport collapses calendar-after-syllabus", () => {
  beforeEach(() => {
    useDatebookStore.setState({
      items: [],
      categories: [ENGL],
      importSources: [],
      deletions: {},
      lastDeleted: null,
      mode: "local",
      userId: null,
    });
  });

  it("folds a later Canvas sync onto the syllabus row", () => {
    const store = () => useDatebookStore.getState();
    store().applySyllabusImport({
      drafts: [draft({ title: "HW 3" })],
      timeZone: TZ,
      forceCategoryId: "engl",
    });
    store().setItemStatus(store().items[0].id, "done");
    const sylId = store().items[0].id;

    store().applyImport("https://canvas.example/feed.ics", {
      calendarName: "Canvas",
      events: [
        {
          uid: "canvas-uid-hw3",
          summary: "Homework 3: Linked Lists [ENGL 101]",
          start: AT,
          url: "https://canvas.example/assignments/3",
          allDay: false,
        },
      ],
    });

    const items = store().items;
    expect(items).toHaveLength(1);
    expect(items[0].sourceUid).toBe("canvas-uid-hw3");
    expect(items[0].status).toBe("done");
    expect(store().deletions[tombKey("item", sylId)]).toBeTruthy();
  });
});

describe("updateCategory rewrites syllabus source URLs", () => {
  beforeEach(() => {
    useDatebookStore.setState({
      items: [],
      categories: [ENGL],
      importSources: [],
      deletions: {},
      lastDeleted: null,
      mode: "local",
      userId: null,
    });
  });

  it("keeps the syllabus source (and items) when the class is renamed", () => {
    const store = () => useDatebookStore.getState();
    store().applySyllabusImport({
      drafts: [draft({ title: "HW 3" })],
      timeZone: TZ,
      forceCategoryId: "engl",
    });
    const sourceId = store().importSources[0].id;
    const itemId = store().items[0].id;
    expect(store().importSources[0].url).toBe(syllabusSourceUrl("ENGL 101"));

    store().updateCategory("engl", { name: "English 101" });

    expect(store().categories.find((c) => c.id === "engl")?.name).toBe("English 101");
    expect(store().importSources).toHaveLength(1);
    expect(store().importSources[0].id).toBe(sourceId);
    expect(store().importSources[0].url).toBe(syllabusSourceUrl("English 101"));
    expect(store().items).toHaveLength(1);
    expect(store().items[0].id).toBe(itemId);
    expect(store().items[0].sourceId).toBe(sourceId);
  });

  it("does not rewrite an http feed URL on rename", () => {
    const store = () => useDatebookStore.getState();
    useDatebookStore.setState({
      importSources: [
        {
          id: "feed",
          url: "https://canvas.example/feed.ics",
          name: "Canvas",
          addedAt: "2026-09-01T00:00:00.000Z",
          lastSyncedAt: "2026-09-01T00:00:00.000Z",
          itemCount: 0,
        },
      ],
    });
    store().updateCategory("engl", { name: "English 101" });
    expect(store().importSources[0].url).toBe("https://canvas.example/feed.ics");
  });
});
