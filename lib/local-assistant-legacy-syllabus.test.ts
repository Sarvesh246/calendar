/**
 * Syllabi imported before course details were kept: the class has due dates
 * (sourceUid `syl:…`) but no `Category.syllabus`. Everything that worked
 * before must keep working without asking for the PDF again.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AssistantCtx } from "./ai-assistant";
import { rowToCategory, toCategoryRow } from "./db-sync";
import { econSyllabus, makeCtx, NOW, at } from "./local-assistant.fixture";
import { resetLocalAssistantState, tryLocalAnswer } from "./local-assistant";
import { applySyllabusImportToSnapshot } from "./syllabus-import";
import type { SyllabusDraft } from "./syllabus-match";

/** CS 101's assignments came from an old syllabus import; Econ has no syllabus at all. */
function legacyCtx(): AssistantCtx {
  const ctx = makeCtx();
  ctx.categories = ctx.categories.map((c) => ({ ...c, syllabus: undefined }));
  ctx.items = ctx.items.map((i) =>
    i.categoryId === "c1" && i.type === "assignment" ? { ...i, sourceId: "src-syl", sourceUid: `syl:${i.at.slice(0, 10)}:${i.id}` } : i
  );
  ctx.items.push({ id: "oh", categoryId: "c1", type: "event", title: "CS 101 Office Hours", at: at(9, 29, 15), endAt: at(9, 29, 16), createdAt: at(9, 1) });
  return ctx;
}

let ctx = legacyCtx();
beforeEach(() => {
  ctx = legacyCtx();
  resetLocalAssistantState();
});
const text = (m: string) => tryLocalAnswer(m, [], ctx, NOW)?.text ?? null;

describe("classes imported from a syllabus before details were saved", () => {
  it("still answers everything that comes from the imported dates", () => {
    expect(text("what's due for cs 101")).toContain("Essay draft");
    expect(text("when is the essay due")).toContain("tomorrow");
    expect(tryLocalAnswer("mark the essay done", [], ctx, NOW)?.actions?.[0]).toMatchObject({ patch: { status: "done" } });
    expect(text("what's overdue")).toContain("Reading response");
  });

  it("answers from the calendar when it can, instead of pointing at the syllabus", () => {
    expect(text("when are office hours for cs 101")).toMatch(/Office Hours/);
  });

  it("says the dates are there and re-adding is optional, not that nothing was imported", () => {
    const r = text("who teaches cs 101")!;
    expect(r).toMatch(/I have \*\*CS 101\*\*'s due dates from its syllabus/);
    expect(r).toMatch(/assignments and progress stay/);
    expect(text("what's the late policy")).toMatch(/^I have \*\*CS 101\*\*'s due dates from its syllabus, but not late work/);
  });

  it("understands a casual grading question about an old import", () => {
    ctx.categories.push({ id: "c9", name: "ENGR 102", color: "#FF2D55" });
    ctx.items.push({ id: "e1", categoryId: "c9", type: "assignment", title: "Quiz 1", at: "2026-09-30T04:59:00.000Z", status: "todo", createdAt: "2026-09-01T00:00:00.000Z", sourceUid: "syl:2026-09-29:q1" });
    const r = text("can u check what percentage of my grade is the quizzes in my engr 102 class")!;
    expect(r).toMatch(/^I have \*\*ENGR 102\*\*'s due dates from its syllabus, but not the grade breakdown/);
  });

  it("keeps the old reply for a class that never had a syllabus", () => {
    expect(text("who teaches econ")).toMatch(/don't have the \*\*Econ\*\* syllabus saved/);
  });

  it("leaves general questions about imported classes to the calendar", () => {
    expect(text("what are my classes")).toContain("CS 101");
    expect(text("how many assignments are due this week")).toMatch(/assignments?/);
  });
});

describe("re-adding an old syllabus is safe", () => {
  const drafts: SyllabusDraft[] = [
    { title: "Essay draft", at: at(9, 25, 23, 59), type: "assignment", kind: "paper" },
    { title: "Problem Set 9", at: at(10, 20, 23, 59), type: "assignment", kind: "homework" },
  ];

  it("adds the details without duplicating assignments or losing progress", () => {
    const base = { items: [], categories: [{ id: "c2", name: "Econ", color: "#34C759" }], importSources: [], deletions: {} };
    const first = applySyllabusImportToSnapshot(base, { drafts, timeZone: "UTC", forceCategoryId: "c2" }, { now: "2026-09-01T00:00:00.000Z", id: (() => { let n = 0; return () => `a${++n}`; })() });
    expect(first.snapshot.categories[0].syllabus).toBeUndefined();

    // The user worked through the term: one assignment is done.
    const worked = {
      ...first.snapshot,
      items: first.snapshot.items.map((i) => (i.title === "Essay draft" ? { ...i, status: "done" as const, completedAt: "2026-09-20T00:00:00.000Z" } : i)),
    };
    const again = applySyllabusImportToSnapshot(worked, { drafts, timeZone: "UTC", forceCategoryId: "c2", info: econSyllabus }, { now: "2026-09-24T00:00:00.000Z", id: (() => { let n = 0; return () => `b${++n}`; })() });

    expect(again.result.added).toBe(0);
    expect(again.snapshot.items).toHaveLength(2);
    expect(again.snapshot.items.find((i) => i.title === "Essay draft")?.status).toBe("done");
    expect(again.snapshot.categories[0].syllabus?.people[0].name).toBe("Dr. Maria Lopez");
  });

  it("an import that finds no details never wipes details already saved", () => {
    const withInfo = { items: [], categories: [{ id: "c2", name: "Econ", color: "#34C759", syllabus: econSyllabus }], importSources: [], deletions: {} };
    const out = applySyllabusImportToSnapshot(withInfo, { drafts, timeZone: "UTC", forceCategoryId: "c2" }, { now: "2026-09-24T00:00:00.000Z", id: () => "x" });
    expect(out.snapshot.categories[0].syllabus).toBe(econSyllabus);
  });
});

describe("old synced rows", () => {
  it("load from a database row that predates the syllabus column", () => {
    const cat = rowToCategory({ id: "c1", user_id: "u", name: "CS 101", color: "#007AFF", archived: false, source_id: null, updated_at: "2026-09-01T00:00:00.000Z" });
    expect(cat).toMatchObject({ id: "c1", name: "CS 101" });
    expect(cat.syllabus).toBeUndefined();
  });

  it("ignore a malformed syllabus value instead of failing the sync", () => {
    expect(rowToCategory({ id: "c1", name: "CS 101", color: "#007AFF", syllabus: "oops" }).syllabus).toBeUndefined();
    expect(toCategoryRow({ id: "c1", name: "CS 101", color: "#007AFF" }, "u").syllabus).toBeNull();
  });
});
