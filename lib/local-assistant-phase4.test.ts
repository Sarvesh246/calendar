import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantResponse, AssistantTurn } from "./ai-assistant";
import { resetLocalAssistantState, tryLocalAnswer } from "./local-assistant";
import { makeCtx, NOW } from "./local-assistant.fixture";
import { answerMath, evaluate } from "./local-math";
import { parseQuickAdd } from "./quick-add-parser";

// The quick-add parser reads relative days off the real clock; pin it to the fixture's.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

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

describe("math", () => {
  it("evaluates plain arithmetic with precedence", () => {
    expect(evaluate("2 + 3 * 4")).toBe(14);
    expect(evaluate("(2 + 3) * 4")).toBe(20);
    expect(evaluate("2 ^ 3 ^ 2")).toBe(512);
    expect(evaluate("-3 + 5")).toBe(2);
    expect(evaluate("50%")).toBe(0.5);
    expect(evaluate("1,200 / 4")).toBe(300);
    expect(evaluate("12 x 3")).toBe(36);
    expect(evaluate("7 / 0")).toBeNull();
    expect(evaluate("42")).toBeNull();
  });

  it("answers everyday math asks", () => {
    expect(text("what's 23 x 17")).toBe("23 × 17 = **391**.");
    expect(text("what is 15% of 80")).toBe("15% of 80 is **12**.");
    expect(text("42 out of 50 as a percent")).toBe("42 out of 50 is **84%**.");
    expect(text("how many minutes in 3.5 hours")).toBe("3.5 hours is **210 minutes**.");
    expect(text("convert 90 minutes to hours")).toBe("90 minutes is **1.5 hours**.");
    expect(text("calculate 12 times 4")).toBe("12 × 4 = **48**.");
  });

  it("leaves algebra, dates and clock math alone", () => {
    expect(answerMath("what is 2x + 3")).toBeUndefined();
    expect(ask("solve 2x+3=7")).toBeNull();
    expect(answerMath("what is due 9/25")).toBeUndefined();
    expect(answerMath("what is 9/25")).toBeUndefined();
    expect(answerMath("what is 2 hours from now")).toBeUndefined();
    expect(text("what's due 9/25")).toMatch(/Essay draft/);
  });
});

describe("grades", () => {
  it("works out what's needed on the final from the syllabus weight", () => {
    const t = text("what do i need on the econ final to get a B if i have an 84")!;
    expect(t).toContain("With an **84**");
    expect(t).toContain("35% of your Econ grade");
    expect(t).toContain("**81.1**");
    expect(t).toContain("a **B** (83)");
  });

  it("says when a target is out of reach and offers the next letter", () => {
    const t = text("what do i need on the final in econ to get an A, i'm at 88")!;
    expect(t).toMatch(/\*\*102\.3\*\*.*out of reach/);
    expect(t).toMatch(/A \*\*B\*\* \(83\) needs \*\*73\.7\*\*/);
  });

  it("asks for the current grade, then answers", () => {
    const [q, a] = chat("what do I need on the final in econ to get an A", "88");
    expect(q!.text).toBe("What's your grade in **Econ** right now, going into the **final exam**?");
    expect(a!.text).toContain("With an **88**");
  });

  it("uses a weight the user gives when there's no syllabus", () => {
    const t = text("what do i need on the cs 101 final to get a 90 if the final is worth 40% and i have an 85")!;
    expect(t).toContain("**97.5**");
  });

  it("averages the scores given, weighted by the syllabus", () => {
    const t = text("i got 92 on problem sets and 81 on the midterm in econ, what's my grade")!;
    expect(t).toContain("you're at **86** in **Econ**");
    expect(t).toContain("55% of the grade");
    expect(t).toContain("a **B** on the syllabus scale");
  });

  it("explains it can't see grades, and shows the breakdown", () => {
    expect(text("what's my grade in econ")).toMatch(/can't see your grade in \*\*Econ\*\*[\s\S]*Final exam\*\* — 35%/);
    expect(text("am i passing econ")).toMatch(/Datebook doesn't keep your scores/);
    expect(text("what's my grade")).toMatch(/Datebook doesn't keep your scores/);
  });

  it("still leaves pass/fail cut-offs it can't know to the model", () => {
    expect(ask("what do i need on the final to pass econ")).toBeNull();
  });
});

describe("emails", () => {
  it("drafts an extension request with the item, instructor and late policy", () => {
    const t = text("write an email to my econ professor asking for an extension on problem set 4 because I've been sick")!;
    expect(t).toContain("**Dr. Maria Lopez** (mlopez@uni.edu)");
    expect(t).toContain("Extension request — Problem Set 4 (ECON 101)");
    expect(t).toContain("Dear Dr. Lopez,");
    expect(t).toContain("which is due Thursday, Oct 1");
    expect(t).toContain("I've been sick.");
    expect(t).toContain("lose 10% per day late");
  });

  it("drafts an absence note for a day", () => {
    const t = text("draft an email to my econ professor saying i'll miss class tomorrow because of a family emergency")!;
    expect(t).toContain("Missing class — Friday, Sep 25 (ECON 101)");
    expect(t).toContain("won't be able to attend ECON 101 tomorrow (Friday, Sep 25) because of a family emergency.");
    expect(t).toMatch(/Attendance is taken/);
  });

  it("writes to the TA with their office hours", () => {
    const t = text("email the econ TA to set up a meeting about my midterm")!;
    expect(t).toContain("Hi Sam,");
    expect(t).toContain("talk about my midterm");
    expect(t).toContain("Wed 11 AM–12 PM");
  });

  it("finds the class from the instructor's name", () => {
    expect(text("write an email to dr lopez about meeting in office hours")).toContain("how I'm doing in ECON 101");
  });

  it("leaves open-ended writing and address lookups alone", () => {
    expect(ask("email my professor about the reading")).toBeNull();
    expect(text("what's the professor's email for econ")).toContain("mlopez@uni.edu");
    expect(ask("email my professor asking for an extension")).toBeNull(); // which class?
  });
});

describe("study plans", () => {
  it("spreads sessions before the exam, the last one the day before", () => {
    const r = ask("make me a study plan for the midterm")!;
    const drafts = r.actions!.flatMap((a) => (a.kind === "create" ? [a.draft] : []));
    expect(drafts).toHaveLength(4);
    const exam = ctx.items.find((i) => i.title === "Midterm exam")!;
    const days = drafts.map((d) => new Date(d.at).toDateString());
    expect(new Set(days).size).toBe(4);
    for (const d of drafts) {
      expect(d.title).toBe("Study for: Midterm exam");
      expect(+new Date(d.endAt!)).toBeLessThan(+new Date(exam.at));
      expect(d.workFor).toBeUndefined();
    }
    expect(new Date(drafts[3].at).getDate()).toBe(new Date(exam.at).getDate() - 1);
  });

  it("finds the class's next exam", () => {
    expect(text("help me study for econ")).toContain("**Midterm exam**");
  });

  it("leaves one-day study blocks to the planner", () => {
    expect(text("schedule study time for econ tomorrow")).toMatch(/study for \*\*Econ\*\*/);
  });
});

describe("feeling behind", () => {
  it("triages when asked where to start", () => {
    const t = text("i'm so overwhelmed with homework, what do i drop")!;
    expect(t).toMatch(/\*\*Focus on these first:\*\*\n- \*\*Reading response\*\* — overdue/);
    expect(t).toContain("**These can wait:** **Problem Set 4**");
    expect(t).toContain("push buy textbook to next week");
    expect(text("i'm so behind on everything")).toMatch(/Focus on these first/);
  });

  it("leaves feelings and anything heavier to the model", () => {
    expect(ask("i'm stressed")).toBeNull();
    expect(ask("i'm so stressed about this week")).toBeNull();
    expect(ask("i'm so behind and i want to give up")).toBeNull();
    expect(ask("i'm overwhelmed and anxious, where do i start")).toBeNull();
  });
});

describe("adds that need a time", () => {
  it("asks for the time, then adds it", () => {
    const [q, a] = chat("add dinner with Sam tomorrow", "7pm");
    expect(q!.text).toBe("What time is **Dinner with Sam** tomorrow?");
    expect(a!.text).toBe("I'll add **Dinner with Sam** **tomorrow at 7:00 PM**. Confirm below.");
  });

  it("asks when, for a reminder with no day", () => {
    const [q, a] = chat("remind me to call mom", "tomorrow at 5pm");
    expect(q!.text).toBe("When should I remind you to call mom?");
    expect(a!.actions?.[0]).toMatchObject({ kind: "create", draft: { title: "Call mom" } });
  });

  it("drops the add on never mind", () => {
    expect(chat("add gym", "never mind")[1]!.text).toBe("No problem — I won't add it.");
  });

  it("still leaves vague adds to the model", () => {
    expect(ask("add something later")).toBeNull();
  });

  it("keeps 'with' in titles", () => {
    expect(parseQuickAdd("coffee with Alex friday 3pm", []).title).toBe("Coffee with Alex");
    expect(parseQuickAdd("lunch at 3pm tomorrow with a reminder 10 minutes before", []).title).toBe("Lunch");
  });
});

describe("which one", () => {
  it("asks among up to six matches and takes an ordinal", () => {
    for (let k = 5; k <= 8; k += 1) {
      ctx.items.push({ id: `ps${k}`, title: `Problem Set ${k}`, type: "assignment", at: new Date(2026, 9, k + 5, 23, 59).toISOString(), categoryId: "c2", status: "todo", createdAt: NOW.toISOString() });
    }
    const [q, a] = chat("mark problem set done", "the fifth one");
    expect(q!.text).toMatch(/^Which one do you mean/);
    expect(a!.actions?.[0]).toMatchObject({ kind: "update" });
  });
});
