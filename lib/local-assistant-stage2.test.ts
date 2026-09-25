import { beforeEach, describe, expect, it } from "vitest";
import { resetLocalAssistantState, tryLocalAnswer } from "./local-assistant";
import { makeCtx, NOW } from "./local-assistant.fixture";
import type { AssistantResponse, AssistantTurn } from "./ai-assistant";

let ctx = makeCtx();
beforeEach(() => {
  ctx = makeCtx();
  resetLocalAssistantState();
});

/** Replays a conversation the way the chat does: each reply becomes history. */
function chat(...messages: string[]): Array<AssistantResponse | null> {
  const history: AssistantTurn[] = [];
  return messages.map((m) => {
    const r = tryLocalAnswer(m, history, ctx, NOW);
    history.push({ role: "user", text: m }, { role: "assistant", text: r?.text ?? "(model reply)" });
    return r;
  });
}
const ask = (m: string) => tryLocalAnswer(m, [], ctx, NOW);
const text = (m: string) => ask(m)?.text ?? null;

describe("syllabus questions", () => {
  it("answers staff, contact and office hours", () => {
    expect(text("who is my econ professor?")).toContain("Dr. Maria Lopez");
    expect(text("what's the professor's email for econ")).toContain("mlopez@uni.edu");
    expect(text("when are office hours for econ")).toContain("Tue 2–4 PM");
    expect(text("who's my TA")).toContain("Sam Chen");
    expect(text("where is the professor's office")).toContain("Lyon 310");
    expect(text("what's the prof's office")).toContain("Lyon 310");
  });

  it("answers grading, scale and materials", () => {
    expect(text("how much is the final worth")).toMatch(/Final exam.*35%/);
    expect(text("how is econ graded")).toContain("Participation");
    expect(text("what's a B in econ")).toMatch(/a \*\*B\*\* is \*\*83–86/);
    expect(text("what textbook do I need for econ")).toContain("Mankiw");
  });

  it("answers policies and says plainly when one isn't covered", () => {
    expect(text("what's the late policy?")).toContain("10% per day");
    expect(text("can i use chatgpt for econ")).toContain("AI tools");
    expect(text("what happens if I miss class")).toContain("unexcused");
    expect(text("can i work with friends on problem sets")).toMatch(/doesn't mention collaboration/);
    expect(text("is there a curve")).toMatch(/doesn't mention a curve/);
  });

  it("answers key dates in the right tense", () => {
    expect(text("when is the drop deadline")).toMatch(/Last day to drop.*is \*\*Fri, Oct 9/);
    expect(text("when does the semester start")).toMatch(/was \*\*Mon, Aug 24/);
    expect(text("how many days until thanksgiving break")).toContain("62 days");
  });

  it("is honest about classes without saved details", () => {
    expect(text("who teaches cs 101")).toMatch(/don't have the \*\*CS 101\*\* syllabus/);
  });

  it("does not answer calendar questions from the syllabus", () => {
    expect(text("am I late on anything")).toContain("Reading response");
    expect(text("when is my meeting with professor lopez")).toBeNull();
  });

  it("handles a follow-up topic after asking what they want to know", () => {
    const [first, grading] = chat("what does the syllabus say", "grading");
    expect(first?.text).toMatch(/What do you want to know\?$/);
    expect(grading?.text).toContain("Midterm exam");
  });
});

describe("app help", () => {
  it("points at the real controls", () => {
    expect(text("how do I import my canvas calendar")).toContain("Settings → Import → Calendar link");
    expect(text("how do i change the theme")).toContain("Settings → Look");
    expect(text("where do I add class times")).toContain("Class times");
    expect(text("how do I export my calendar")).toContain("Backup & export");
  });
});

describe("conversation", () => {
  it("resolves 'which one?' by ordinal or by name", () => {
    const [q1, a1] = chat("mark problem set done", "the second one");
    expect(q1?.text).toMatch(/^Which one/);
    expect(a1?.actions?.[0]).toMatchObject({ itemTitle: "Problem Set 4", patch: { status: "done" } });
    resetLocalAssistantState();
    const [, a2] = chat("mark problem set done", "problem set 3");
    expect(a2?.actions?.[0]).toMatchObject({ itemTitle: "Problem Set 3" });
  });

  it("resolves 'it' and 'them' from the last reply", () => {
    const [, moved] = chat("when is the essay due", "move it to monday");
    expect(moved?.actions?.[0]).toMatchObject({ kind: "update", itemTitle: "Essay draft" });
    const [, done] = chat("what's overdue?", "mark them done");
    expect(done?.actions?.[0]).toMatchObject({ itemTitle: "Reading response" });
  });

  it("plans time for 'it'", () => {
    const [, r] = chat("when is problem set 4 due", "block an hour tomorrow afternoon for it");
    expect(r?.actions?.[0]).toMatchObject({ kind: "create", draft: { title: "Work on: Problem Set 4" } });
  });

  it("defers when 'it' could mean more than one thing", () => {
    const [, r] = chat("what's on tomorrow", "move it to saturday");
    expect(r).toBeNull();
  });
});

describe("multi-step commands", () => {
  it("runs compound commands as one confirm", () => {
    const r = ask("mark essay done and move problem set 4 to saturday")!;
    expect(r.actions?.map((a) => a.kind)).toEqual(["update", "update"]);
    expect(r.text.match(/Confirm below/g)?.length).toBe(1);
    const mixed = ask("cancel my dentist appointment and add a haircut friday at 3pm")!;
    expect(mixed.actions?.map((a) => a.kind)).toEqual(["delete", "create"]);
  });

  it("handles several objects and bulk selections", () => {
    expect(ask("mark the essay and problem set 4 done")?.actions).toHaveLength(2);
    expect(ask("delete all my econ homework")?.actions).toHaveLength(2);
    expect(ask("mark all overdue as done")?.actions?.[0]).toMatchObject({ itemTitle: "Reading response" });
    expect(text("move everything due friday to monday")).toContain("to Mon, Sep 28");
    expect(ask("delete everything")).toBeNull();
  });

  it("defers compound commands when any part is unclear", () => {
    expect(ask("mark essay done and move the thing to friday")).toBeNull();
  });
});

describe("planning time", () => {
  it("blocks free time before the deadline and never moves it", () => {
    const r = ask("block an hour tomorrow afternoon for problem set 4")!;
    const a = r.actions![0];
    expect(a.kind).toBe("create");
    if (a.kind === "create") {
      expect(a.draft.workFor).toBe(ctx.items.find((i) => i.title === "Problem Set 4")!.id);
      expect(new Date(a.draft.at).getHours()).toBeGreaterThanOrEqual(12);
      expect(new Date(a.draft.at).getDate()).toBe(25);
    }
    expect(r.text).toMatch(/deadline stays/);
  });

  it("plans for a class or an exam", () => {
    expect(text("schedule study time for econ tomorrow")).toMatch(/study for \*\*Econ\*\*/);
    const exam = ask("find time to study for the midterm")!.actions![0];
    if (exam.kind === "create") expect(exam.draft.workFor).toBeUndefined();
  });

  it("answers 'when should I work on X' with an offer", () => {
    expect(text("when should I work on problem set 4")).toMatch(/^Your next open hour is/);
  });
});

describe("edits", () => {
  it("changes class, location, notes and due time", () => {
    expect(ask("put the essay under econ")?.actions?.[0]).toMatchObject({ patch: { categoryId: "c2" } });
    expect(ask("set the location of the dentist appointment to 45 Main St")?.actions?.[0]).toMatchObject({ patch: { location: "45 Main St" } });
    expect(ask("add a note to the essay: use MLA format")?.actions?.[0]).toMatchObject({ patch: { description: "use MLA format" } });
    const noon = ask("make the essay due at noon")!.actions![0];
    if (noon.kind === "update") expect(new Date(noon.patch.at!).getHours()).toBe(12);
  });

  it("reads 'next tuesday' as the Tuesday of next week", () => {
    const r = ask("reschedule the dentist to next tuesday at 10am")!.actions![0];
    if (r.kind === "update") expect(new Date(r.patch.at!).getDate()).toBe(29);
  });

  it("keeps the location as it was said", () => {
    expect(text("add dinner at olive garden friday at 7pm")).toContain("at Olive Garden");
    expect(text("add team meeting at the library tomorrow at 3pm")).toContain("at the library");
  });
});

describe("general questions", () => {
  it("does date math and countdowns", () => {
    expect(text("what day is oct 12")).toContain("Monday");
    expect(text("how many days until the dentist appointment")).toContain("12 days");
    expect(text("how long is the midterm")).toContain("1 h 30 min");
    expect(text("what week is it")).toContain("week 5");
  });

  it("lists classes and reports progress", () => {
    expect(text("what are my classes")).toMatch(/CS 101[\s\S]*Econ/);
    expect(text("what are my classes")).not.toContain("Personal");
    expect(text("how am I doing")).toMatch(/finished \*\*1 item\*\*/);
  });

  it("answers free time across a week", () => {
    expect(text("when am i free this weekend")).toContain("wide open");
  });

  it("leaves general knowledge to the model", () => {
    expect(ask("what's the weather tomorrow")).toBeNull();
    expect(ask("write me an email to my professor asking for an extension")).toBeNull();
  });
});
