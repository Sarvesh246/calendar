import { beforeEach, describe, expect, it } from "vitest";
import type { AssistantResponse, AssistantTurn } from "./ai-assistant";
import { resetLocalAssistantState, tryLocalAnswer } from "./local-assistant";
import { at, makeCtx, NOW } from "./local-assistant.fixture";

let ctx = makeCtx();
beforeEach(() => {
  ctx = makeCtx();
  resetLocalAssistantState();
});
const ask = (m: string) => tryLocalAnswer(m, [], ctx, NOW);
const text = (m: string) => ask(m)?.text ?? null;
function chat(...messages: string[]): Array<AssistantResponse | null> {
  const history: AssistantTurn[] = [];
  return messages.map((m) => {
    const r = tryLocalAnswer(m, history, ctx, NOW);
    history.push({ role: "user", text: m }, { role: "assistant", text: r?.text ?? "(model reply)" });
    return r;
  });
}

describe("planning", () => {
  it("plans the week as linked work blocks before each deadline", () => {
    const r = ask("plan my week")!;
    const creates = r.actions!.filter((a) => a.kind === "create");
    expect(creates.length).toBeGreaterThanOrEqual(3);
    for (const a of creates) {
      if (a.kind !== "create") continue;
      const work = ctx.items.find((i) => i.id === a.draft.workFor)!;
      expect(work).toBeDefined();
      const overdue = +new Date(work.at) < +NOW;
      if (!overdue) expect(+new Date(a.draft.endAt!)).toBeLessThanOrEqual(+new Date(work.at));
    }
    expect(r.text).toMatch(/None of your due dates move/);
  });

  it("keeps blocks apart and inside the day", () => {
    const creates = ask("block time for all my assignments this week")!.actions!.flatMap((a) => (a.kind === "create" ? [a.draft] : []));
    const sorted = creates.sort((a, b) => +new Date(a.at) - +new Date(b.at));
    for (let i = 1; i < sorted.length; i++) expect(+new Date(sorted[i].at)).toBeGreaterThanOrEqual(+new Date(sorted[i - 1].endAt!) + 15 * 60_000);
    for (const d of sorted) expect(new Date(d.at).getHours()).toBeGreaterThanOrEqual(9);
  });

  it("only plans the weekend around work due then", () => {
    expect(text("help me plan my weekend")).toContain("Buy textbook");
    expect(text("help me plan my weekend")).not.toContain("Essay draft");
  });

  it("says so when everything already has time blocked", () => {
    const essay = ctx.items.find((i) => i.title === "Essay draft")!;
    ctx.items.push({ id: "s1", categoryId: essay.categoryId, type: "event", title: "Work on: Essay draft", at: at(9, 24, 16), endAt: at(9, 24, 17), workFor: essay.id, createdAt: at(9, 1) });
    expect(text("plan my week")).not.toMatch(/— Essay draft/);
  });
});

describe("judgement calls with a clear answer", () => {
  it("compares two items by deadline", () => {
    expect(text("should I do the essay or problem set 4 first?")).toBe("Start with **Essay draft** — it's due tomorrow, and **Problem Set 4** isn't due until Thu, Oct 1.");
    expect(text("essay or problem set 3 first")).toMatch(/^Start with \*\*Problem Set 3\*\*/);
  });

  it("puts overdue work first when prioritizing", () => {
    expect(text("what should I prioritize this week")).toMatch(/1\. \*\*Reading response\*\* — overdue/);
  });

  it("summarizes the week, a day, and the past", () => {
    expect(text("summarize my week")).toMatch(/Due: .*Problem Set 3/);
    expect(text("give me a rundown of tomorrow")).toContain("You're free");
    expect(text("recap yesterday")).toContain("Lab report");
  });

  it("reads the workload from estimates and free time", () => {
    expect(text("is my week realistic")).toMatch(/looks \*\*(?:very manageable|full but doable|tight)/);
    expect(text("how's my workload next week")).not.toContain("overdue");
  });

  it("leaves feelings to the model", () => {
    expect(ask("i'm so stressed about this week")).toBeNull();
    expect(ask("i feel overwhelmed, is my week realistic")).toBeNull();
  });
});

describe("calendar checks", () => {
  it("finds real overlaps only", () => {
    expect(text("do i have any conflicts this week")).toMatch(/^No conflicts/);
    ctx.items.push({ id: "x", categoryId: "c3", type: "event", title: "Club meeting", at: at(9, 24, 14, 30), endAt: at(9, 24, 15, 30), createdAt: at(9, 1) });
    const r = text("am i double booked today")!;
    expect(r).toContain("Club meeting");
    expect(r).toContain("Econ Seminar");
    expect(r).not.toContain("CS 101 Lecture");
  });

  it("breaks work down by class", () => {
    expect(text("which class has the most work this week")).toMatch(/^\*\*CS 101\*\* has the most/);
    expect(text("how much do i have for each class")).toMatch(/by class:/);
  });

  it("reads an item's details, notes, link and reminders", () => {
    expect(text("tell me about the dentist appointment")).toContain("Main St Dental");
    expect(text("what are the notes on the essay")).toMatch(/doesn't have any notes/);
    expect(text("what's the link for problem set 4")).toMatch(/doesn't have a link/);
    expect(text("what reminders are on the essay")).toMatch(/no reminders/);
    expect(text("what's in lyon hall 204")).toContain("Midterm exam");
  });
});

describe("class times from chat", () => {
  it("adds weekly meetings for a class with none saved, ending with the semester", () => {
    ctx.categories.push({ id: "c4", name: "BIO 110", color: "#AF52DE", syllabus: { ...ctx.categories[1].syllabus!, keyDates: [{ label: "Last day of classes", date: "2026-12-11" }] } });
    const r = ask("bio 110 meets tth 9:30-10:45 in hall b")!;
    const a = r.actions![0];
    expect(a.kind).toBe("create");
    if (a.kind === "create") {
      expect(a.draft.repeat).toMatchObject({ freq: "weekly", byDay: [2, 4] });
      expect(a.draft.location).toBe("Hall B");
      expect(a.draft.categoryId).toBe("c4");
      expect(a.draft.reminders).toEqual([]);
    }
    expect(r.text).toContain("until Dec 11");
  });

  it("won't add a second set of times on top of saved ones", () => {
    const r = ask("cs 101 meets mwf 10-10:50 in hall b")!;
    expect(r.actions).toBeUndefined();
    expect(r.text).toContain("Schedule → Class times");
  });
});

describe("more edits", () => {
  it("changes length and end time", () => {
    const len = ask("make the dentist appointment 2 hours long")!.actions![0];
    if (len.kind === "update") expect(new Date(len.patch.endAt!).getHours()).toBe(16);
    const ext = ask("extend the econ seminar by 30 minutes")!.actions![0];
    if (ext.kind === "update") expect(new Date(ext.patch.endAt!).getMinutes()).toBe(45);
    const end = ask("the dentist appointment should end at 3:30pm")!.actions![0];
    if (end.kind === "update") expect(new Date(end.patch.endAt!).getHours()).toBe(15);
  });

  it("copies an item without touching the original", () => {
    const r = ask("copy the econ seminar to saturday at 10am")!;
    const a = r.actions![0];
    expect(a.kind).toBe("create");
    if (a.kind === "create") {
      expect(new Date(a.draft.at).getDay()).toBe(6);
      expect(+new Date(a.draft.endAt!) - +new Date(a.draft.at)).toBe(75 * 60_000);
    }
  });

  it("switches all-day, type, reminders and cleared fields", () => {
    expect(ask("make the dentist appointment all day")?.actions?.[0]).toMatchObject({ patch: { allDay: true } });
    expect(ask("make buy textbook an assignment")?.actions?.[0]).toMatchObject({ patch: { type: "assignment" } });
    expect(ask("remove the location from the dentist appointment")?.actions?.[0]).toMatchObject({ kind: "update" });
    expect(text("remove the reminders from the essay")).toMatch(/doesn't have any reminders/);
  });

  it("never reads 'remove reminders from X' as deleting X", () => {
    ctx.items.find((i) => i.title === "Essay draft")!.reminders = [{ id: "r", itemId: "x", offsetMinutes: 60, label: "1 hour before" }];
    const a = ask("remove the reminders from the essay")!.actions![0];
    expect(a).toMatchObject({ kind: "update", patch: { reminders: [] } });
  });
});

describe("replies to a proposal", () => {
  it("acknowledges never mind and explains confirming", () => {
    const [, no] = chat("move the essay to monday", "never mind");
    expect(no?.text).toMatch(/nothing's changed|won't change/);
    resetLocalAssistantState();
    const [, yes] = chat("mark the essay done", "yes do it");
    expect(yes?.text).toMatch(/Tap the button on the card/);
  });

  it("treats 'this week' as a date, not a pronoun", () => {
    expect(ask("block time for all my assignments this week")?.actions?.length).toBeGreaterThan(0);
  });
});
