import { afterEach, describe, expect, it, vi } from "vitest";
import { tryLocalAnswer, localReplyDelayMs, resetLocalAssistantState } from "./local-assistant";
import { beforeEach } from "vitest";
import type { AssistantCtx, AssistantTurn } from "./ai-assistant";
import type { Category, Item } from "./types";

// Thursday, Sep 24 2026, 10:00 local.
const NOW = new Date(2026, 8, 24, 10, 0, 0);
const at = (m: number, d: number, h = 0, min = 0) => new Date(2026, m - 1, d, h, min).toISOString();

const categories: Category[] = [
  { id: "c1", name: "CS 101", color: "#007AFF" },
  { id: "c2", name: "Econ", color: "#34C759" },
  { id: "c3", name: "Personal", color: "#FF9500" },
];

let seq = 0;
function item(p: Partial<Item> & Pick<Item, "title" | "type" | "at">): Item {
  seq += 1;
  return { id: `i${seq}`, categoryId: "c3", createdAt: at(9, 1), ...p };
}

const lecture = (m: number, d: number) =>
  item({
    title: "CS 101 Lecture",
    type: "event",
    at: at(m, d, 10),
    endAt: at(m, d, 11, 15),
    categoryId: "c1",
    location: "Hall B",
    repeat: { freq: "weekly", byDay: [1, 3, 5] },
    repeatId: "r1",
  });

const items: Item[] = [
  lecture(9, 23),
  lecture(9, 25),
  lecture(9, 28),
  lecture(9, 30),
  item({
    title: "Econ Seminar",
    type: "event",
    at: at(9, 24, 14),
    endAt: at(9, 24, 15, 15),
    categoryId: "c2",
    repeat: { freq: "weekly", byDay: [4] },
    repeatId: "r2",
  }),
  item({
    title: "Econ Seminar",
    type: "event",
    at: at(10, 1, 14),
    endAt: at(10, 1, 15, 15),
    categoryId: "c2",
    repeat: { freq: "weekly", byDay: [4] },
    repeatId: "r2",
  }),
  item({
    title: "Dentist appointment",
    type: "event",
    at: at(10, 6, 14),
    location: "Main St Dental",
  }),
  item({
    title: "Essay draft",
    type: "assignment",
    at: at(9, 25, 23, 59),
    categoryId: "c1",
    status: "todo",
  }),
  item({
    title: "Problem Set 3",
    type: "assignment",
    at: at(9, 24, 23, 59),
    categoryId: "c2",
    status: "doing",
  }),
  item({
    title: "Problem Set 4",
    type: "assignment",
    at: at(10, 1, 23, 59),
    categoryId: "c2",
    status: "todo",
  }),
  item({
    title: "Reading response",
    type: "assignment",
    at: at(9, 22, 23, 59),
    categoryId: "c1",
    status: "todo",
  }),
  item({
    title: "Lab report",
    type: "assignment",
    at: at(9, 23, 23, 59),
    categoryId: "c1",
    status: "done",
    completedAt: at(9, 23, 20),
  }),
  item({ title: "Buy textbook", type: "task", at: at(9, 26, 23, 59), status: "todo" }),
];

const ctx: AssistantCtx = { items, categories, clock24h: false, weekStartsOn: 0 };
beforeEach(() => resetLocalAssistantState());
const ask = (text: string, history: AssistantTurn[] = []) =>
  tryLocalAnswer(text, history, ctx, NOW);
/** The words plus the titles of any rows the answer draws — rows are how long
 *  lists are shown, so "does the answer include X" has to look at both. */
const withRows = (r: { text: string; items?: { ids: string[] }[] } | null | undefined) =>
  r
    ? [
        r.text,
        ...(r.items ?? []).flatMap((b) =>
          b.ids.map((id) => ctx.items.find((i) => i.id === id)?.title ?? ""),
        ),
      ].join("\n")
    : null;
const text = (t: string) => withRows(ask(t));

describe("local assistant — deferral", () => {
  it.each([
    "should I study for my exam or finish the essay?",
    "why is my calendar so full",
    "move it to Friday",
    "mark it done",
    "delete everything",
    "xyzzy plugh",
    "what's the weather",
    "",
  ])("hands %j to the model", (message) => {
    expect(ask(message)).toBeNull();
  });

  it("never guesses when nothing matches", () => {
    expect(ask("mark the chemistry lab done")).toBeNull();
    expect(ask("when is my chemistry exam")).toBeNull();
    expect(ask("delete the yoga session")).toBeNull();
  });

  it("hands a short reply to the assistant's own question to the model", () => {
    const history: AssistantTurn[] = [
      { role: "user", text: "mark problem set done" },
      { role: "assistant", text: "Which one do you mean — Problem Set 3 or Problem Set 4?" },
    ];
    expect(ask("the second one", history)).toBeNull();
    expect(ask("4", history)).toBeNull();
  });
});

describe("local assistant — what's due this week", () => {
  it("keeps work that slipped earlier this week, but not finished work", () => {
    const r = text("what's due this week")!;
    expect(r).toContain("Reading response"); // Tue, still open
    expect(r).toContain("Essay draft");
    expect(r).not.toContain("Lab report"); // done
  });

  it("looks a week ahead when the week is down to its last day", () => {
    const saturday = new Date(2026, 8, 26, 10, 0, 0);
    const r = withRows(tryLocalAnswer("what's due this week", [], ctx, saturday)) ?? "";
    expect(r).toMatch(/next 7 days/i);
    expect(r).toContain("Problem Set 4"); // due the following Thursday
  });
});

describe("local assistant — small talk", () => {
  it("answers greetings, thanks, and the clock", () => {
    expect(text("hi")).toMatch(/help|what/i);
    expect(text("thanks!")).toBeTruthy();
    expect(text("what time is it?")).toContain("10:00 AM");
    expect(text("what's today's date")).toContain("Thursday, September 24");
    expect(text("what can you do?")).toMatch(/add|move/i);
  });
});

describe("local assistant — reading the calendar", () => {
  it("lists a day", () => {
    const r = text("what's on tomorrow?")!;
    expect(r).toContain("CS 101 Lecture");
    expect(r).toContain("Essay draft");
    expect(r).not.toContain("Problem Set 3");
  });

  it("handles casual phrasings of the same ask", () => {
    for (const q of [
      "what do I have tomorrow",
      "anything tomorrow?",
      "whats going on tmrw",
      "tomorrow's schedule",
      "what's my schedule tomorrow",
      "show me tomorrow",
    ]) {
      expect(text(q), q).toContain("CS 101 Lecture");
    }
  });

  it("splits today into what's ahead and what already finished", () => {
    const r = text("what's on today")!;
    expect(r).toContain("Econ Seminar");
    expect(r).toContain("Problem Set 3");
    expect(r).toMatch(/overdue/i);
  });

  it("answers by weekday and date", () => {
    expect(text("what do I have on monday")).toContain("CS 101 Lecture");
    expect(text("anything on oct 6?")).toContain("Dentist appointment");
    expect(() => text("what's on the 6th")).not.toThrow(); // ordinal resolves without throwing
  });

  it("answers ranges", () => {
    const r = text("what's due this week")!;
    expect(r).toContain("Essay draft");
    expect(r).toContain("Buy textbook");
    expect(text("what's due next week")).toContain("Problem Set 4");
    expect(text("nothing on my calendar this weekend?")).toBeTruthy();
  });

  it("answers what's due with a class filter", () => {
    const r = text("what's due for econ")!;
    expect(r).toContain("Problem Set 3");
    expect(r).not.toContain("Essay draft");
  });

  it("reports overdue, in progress, and completed accurately", () => {
    expect(text("what's overdue?")).toContain("Reading response");
    expect(text("what's overdue?")).not.toContain("Lab report");
    expect(text("what am I working on?")).toContain("Problem Set 3");
    const done = text("what did I finish this week?")!;
    expect(done).toContain("Lab report");
    expect(text("am I behind?")).toMatch(/overdue|behind/i);
  });

  it("finds the next class and next deadline", () => {
    const cls = text("when's my next class?")!;
    expect(cls).toContain("Econ Seminar");
    expect(cls).toContain("2:00 PM");
    expect(text("what's my next assignment due")).toContain("Problem Set 3");
    expect(text("what's next")).toBeTruthy();
    expect(text("next class")).toContain("Econ Seminar");
  });

  it("answers when/where questions about one thing", () => {
    expect(text("when is my dentist appointment")).toMatch(/Tue, Oct 6.*2:00 PM/);
    expect(text("where is the dentist appointment")).toContain("Main St Dental");
    expect(text("when is the essay due")).toMatch(/Essay draft.*tomorrow/);
    expect(text("when's problem set 4 due")).toContain("Thu, Oct 1");
  });

  it("describes a class from its name", () => {
    const r = text("when is cs 101")!;
    expect(r).toContain("CS 101");
    expect(r).toMatch(/Mon|Fri/);
  });

  it("answers free-time questions from real gaps", () => {
    const tomorrow = text("when am I free tomorrow")!;
    expect(tomorrow).toContain("10:00 AM"); // the lecture starts at 10
    const conflict = text("am I free at 10:30am tomorrow")!;
    expect(conflict).toContain("CS 101 Lecture");
    expect(text("am I free at 3pm tomorrow")).toMatch(/^Yes/);
    expect(text("am I free saturday")).toMatch(/open|free/i);
  });

  it("finds busiest and lightest days", () => {
    expect(text("what's my busiest day this week")).toMatch(/busiest/);
    expect(text("what's my lightest day this week")).toMatch(/lightest/);
  });

  it("counts", () => {
    expect(text("how many assignments are due this week")).toMatch(/\*\*\d+ assignments\*\*/);
    expect(text("how many classes do I have tomorrow")).toContain("1 class");
  });

  it("answers happening-now and first/last questions", () => {
    expect(text("what's happening right now")).toBeTruthy();
    expect(text("when's my first class tomorrow")).toContain("10:00 AM");
    expect(text("what time does my last class end today")).toContain("3:15 PM");
  });

  it("searches", () => {
    expect(text("do I have a dentist appointment coming up")).toContain("Dentist appointment");
    expect(text("do I have any quizzes")).toMatch(/don't see/);
  });

  it("follows up on the previous question with a new day", () => {
    const history: AssistantTurn[] = [
      { role: "user", text: "what's on tomorrow?" },
      { role: "assistant", text: "Tomorrow you have ..." },
    ];
    const r = ask("what about monday?", history)!;
    expect(r.text).toContain("CS 101 Lecture");
  });

  it("uses the 24-hour clock when asked", () => {
    const r = tryLocalAnswer("what's on tomorrow", [], { ...ctx, clock24h: true }, NOW)!;
    expect(r.text).toContain("10:00");
    expect(r.text).not.toMatch(/AM|PM/);
  });

  it("never adds suggestion chips or an offline marker", () => {
    for (const q of ["what's on tomorrow", "what's overdue", "hi"]) {
      const r = ask(q)!;
      expect(r.suggestions).toBeUndefined();
      expect(r.error).toBeUndefined();
    }
  });
});

describe("local assistant — changing the calendar", () => {
  it("completes an item by a loose name", () => {
    for (const q of [
      "mark the essay done",
      "I finished my essay draft",
      "check off essay",
      "essay is done",
      "done with the essay draft",
    ]) {
      const r = ask(q)!;
      expect(r.actions?.[0], q).toMatchObject({ kind: "update", patch: { status: "done" } });
      expect(r.text).toContain("Essay draft");
    }
  });

  it("finds items by class and number", () => {
    const r = ask("mark econ problem set 4 as done")!;
    expect(r.actions?.[0]).toMatchObject({ itemTitle: "Problem Set 4" });
    expect(ask("finished ps 4")?.actions?.[0]).toMatchObject({ itemTitle: "Problem Set 4" });
    expect(ask("finished the quux")).toBeNull();
  });

  it("asks which one when the name is ambiguous", () => {
    const r = ask("mark problem set done")!;
    expect(r.actions).toBeUndefined();
    expect(r.text).toMatch(/Which one/);
    expect(r.text).toContain("Problem Set 3");
    expect(r.text).toContain("Problem Set 4");
  });

  it("says so when something is already done", () => {
    expect(text("mark the lab report done")).toMatch(/already/);
  });

  it("starts and reopens work", () => {
    expect(ask("start the essay")?.actions?.[0]).toMatchObject({ patch: { status: "doing" } });
    expect(ask("reopen the lab report")?.actions?.[0]).toMatchObject({ patch: { status: "todo" } });
  });

  it("moves a deadline, keeping its time", () => {
    const r = ask("move the essay to monday")!;
    const a = r.actions![0];
    expect(a.kind).toBe("update");
    if (a.kind === "update") {
      const d = new Date(a.patch.at!);
      expect(d.getDay()).toBe(1);
      expect(d.getHours()).toBe(23);
      expect(d.getMinutes()).toBe(59);
    }
    expect(r.text).toContain("Mon, Sep 28");
  });

  it("moves with a time, pushes by a delta, and keeps event length", () => {
    const t = ask("move the dentist appointment to 4pm")!.actions![0];
    if (t.kind === "update") expect(new Date(t.patch.at!).getHours()).toBe(16);
    const push = ask("push the essay back a day")!.actions![0];
    if (push.kind === "update") expect(new Date(push.patch.at!).getDate()).toBe(26);
    const week = ask("push the dentist appointment back 2 hours")!.actions![0];
    if (week.kind === "update") expect(new Date(week.patch.at!).getHours()).toBe(16);
    const seminar = ask("move econ seminar to 3pm")!.actions![0];
    if (seminar.kind === "update") {
      expect(new Date(seminar.patch.at!).getHours()).toBe(15);
      expect(new Date(seminar.patch.endAt!).getHours()).toBe(16);
    }
  });

  it("moves only the next instance of a recurring class and says so", () => {
    const r = ask("cancel my cs 101 lecture")!;
    expect(r.actions?.[0]).toMatchObject({ kind: "delete" });
    expect(r.text).toMatch(/just this one/);
  });

  it("deletes with a confirm card and refuses bulk wipes", () => {
    expect(ask("delete the dentist appointment")?.actions?.[0]).toMatchObject({
      kind: "delete",
      itemTitle: "Dentist appointment",
    });
    expect(ask("delete all my events")).toBeNull();
    expect(ask("clear my calendar")).toBeNull();
  });

  it("renames", () => {
    const r = ask("rename the essay draft to Final essay")!;
    expect(r.actions?.[0]).toMatchObject({ kind: "update", patch: { title: "Final essay" } });
  });

  it("adds a reminder to an existing item", () => {
    const r = ask("remind me about the essay 1 day before")!;
    const a = r.actions![0];
    if (a.kind === "update") expect(a.patch.reminders?.[0].offsetMinutes).toBe(1440);
  });

  it("adds simple items and defers rich or vague ones", () => {
    const gym = ask("add gym at 6pm tomorrow")!;
    expect(gym.actions?.[0]).toMatchObject({ kind: "create" });
    expect(gym.text).toMatch(/Gym/);
    const due = ask("add essay outline due friday")!;
    expect(due.actions?.[0]).toMatchObject({ kind: "create", draft: { type: "assignment" } });
    expect(ask("remind me to call mom tomorrow")?.actions?.[0]).toMatchObject({ kind: "create" });
    expect(ask("add something later")).toBeNull();
    expect(ask("add dinner with sam tomorrow")?.text).toMatch(
      /^What time is \*\*Dinner with sam\*\* /,
    ); // no time: ask, don't guess
    expect(
      ask(
        "add a meeting at the library tomorrow at 3pm with a reminder a day before and a reminder an hour before",
      )?.actions?.[0],
    ).toMatchObject({ kind: "create" });
    // A series with no end is hundreds of items: ask until when, don't stage it.
    const open = ask("add yoga every monday at 7am")!;
    expect(open.actions).toBeUndefined();
    expect(open.text).toMatch(/^Until when should \*\*Yoga\*\* repeat\?/i);
    expect(ask("add yoga every monday at 7am until dec 14")?.actions?.[0]).toMatchObject({
      kind: "create",
      draft: { repeat: { freq: "weekly", byDay: [1] } },
    });
  });

  it("splits a pasted list into events", () => {
    const r = ask("Career fair Sept 30 at 2pm\nResume workshop Oct 2 at 4pm")!;
    expect(r.actions?.length).toBe(2);
  });
});

describe("local assistant — more phrasings", () => {
  it("answers 'did I finish X'", () => {
    expect(text("did I finish the lab report")).toMatch(/^Yes/);
    expect(text("have I finished problem set 3")).toMatch(/^Not yet/);
  });

  it("does not treat 'finish X' as an order to mark it done", () => {
    expect(ask("finish the essay by friday")).toBeNull();
  });

  it("answers lecture and plate questions", () => {
    expect(text("when's the lecture")).toContain("Econ Seminar");
    expect(text("what's on my plate")).toMatch(/open items/);
    expect(text("show my assignments")).toMatch(/open assignments/);
  });

  it("keeps titles faithful when adding", () => {
    expect(ask("add lunch with sam friday at noon")).toBeNull();
    expect(ask("schedule a meeting with prof tomorrow at 2pm")).toBeNull();
    expect(ask("add dentist on oct 12 at 9am")?.actions?.[0]).toMatchObject({
      kind: "create",
      draft: { title: "Dentist" },
    });
  });

  it("does not hijack how-to and advice questions", () => {
    for (const q of [
      "what's the best way to study for finals",
      "what do I need to do to prepare for the dentist",
    ]) {
      expect(ask(q), q).toBeNull();
    }
  });
});

describe("local reply pacing", () => {
  it("stays within a short, natural range", () => {
    for (const s of ["ok", "a".repeat(400)]) {
      const ms = localReplyDelayMs(s);
      expect(ms).toBeGreaterThanOrEqual(100);
      // A beat, not a wait: never more than 300ms on-device.
      expect(ms).toBeLessThanOrEqual(300);
    }
  });
});

describe("local assistant — series guard", () => {
  // The clock is pinned so "thursday", "dec 14" and the occurrence count are
  // the same on every day the suite runs.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("does not turn two things joined by 'and' into one weekly series", () => {
    expect(ask("add ZZTEST study group thursday 7pm and ZZTEST lab report due sunday")).toBeNull();
    expect(ask("add study group thursday 7pm and lab report due sunday")).toBeNull();
    expect(ask("add lunch tomorrow at 12 and dinner tomorrow at 7pm")).toBeNull();
  });

  it("does not read two bare weekday names as a repeat", () => {
    expect(ask("add dinner friday saturday")).toBeNull();
    expect(ask("add gym monday wednesday friday at 6am")).toBeNull();
  });

  it("still takes a sentence that really does say it repeats", () => {
    const r = ask("add gym every wednesday at 6am until dec 14")!;
    expect(r.actions?.[0]).toMatchObject({
      kind: "create",
      draft: { repeat: { freq: "weekly", byDay: [3] } },
    });
  });

  it("says how many items a series adds, on the card and in the text", () => {
    const r = ask("add yoga every monday at 7am until dec 14")!;
    const summary = r.actions?.[0].summary ?? "";
    // Mondays from Sep 28 to Dec 14, 2026 inclusive.
    expect(summary).toMatch(/\(12 events\)$/);
    expect(r.text).toContain("12 events");
    expect(r.text).toMatch(/until Dec 14/);
  });

  it("asks until when, and the answer finishes the add", () => {
    const first = ask("add yoga every monday at 7am")!;
    expect(first.actions).toBeUndefined();
    const history: AssistantTurn[] = [
      { role: "user", text: "add yoga every monday at 7am" },
      { role: "assistant", text: first.text },
    ];
    const done = ask("dec 14", history)!;
    expect(done.actions?.[0]).toMatchObject({
      kind: "create",
      draft: { repeat: { freq: "weekly", byDay: [1] } },
    });
    expect(done.text).toContain("12 events");
  });
});

describe("local assistant — free time and what is due", () => {
  // Tuesday, Nov 10 2026, evening. Pinned so "thursday" means the 12th.
  const TUE = new Date(2026, 10, 10, 20, 0, 0);
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TUE);
  });
  afterEach(() => vi.useRealTimers());

  const study = (h: number, m = 0): Item => ({
    id: `sg${h}`,
    title: "Study group",
    type: "event",
    at: new Date(2026, 10, 12, h, m).toISOString(),
    categoryId: "c3",
    createdAt: new Date(2026, 10, 1).toISOString(),
  });
  const withItems = (extra: Item[]): AssistantCtx => ({ ...ctx, items: extra });
  const answer = (q: string, extra: Item[]) =>
    tryLocalAnswer(q, [], withItems(extra), TUE)?.text ?? null;

  it("never calls a day with a 19:00 event wide open", () => {
    const r = answer("when am I free on thursday?", [study(19)])!;
    expect(r).not.toMatch(/wide open|nothing timed/i);
    expect(r).toMatch(/7:00 PM/); // the gap ends where the event starts
  });

  it("does not say yes to a slot a 7pm event occupies", () => {
    const r = answer("am i free thursday at 7pm?", [study(19)])!;
    expect(r).toMatch(/^Not quite/);
    expect(r).toContain("Study group");
  });

  it("still says wide open for a day with nothing at all", () => {
    expect(answer("when am I free on thursday?", [])).toMatch(/wide open/i);
  });

  it("mentions an event that falls outside the 8-to-10 window", () => {
    const r = answer("when am I free on thursday?", [study(23)])!;
    expect(r).not.toMatch(/wide open/i);
    expect(r).toContain("Study group");
  });

  it("lists a one-off event under 'on your calendar', never as due", () => {
    const hw: Item = {
      id: "hw",
      title: "Lab report",
      type: "assignment",
      status: "todo",
      at: new Date(2026, 10, 13, 23, 59).toISOString(),
      categoryId: "c3",
      createdAt: new Date(2026, 10, 1).toISOString(),
    };
    const r = answer("what's due this week?", [hw, study(19)])!;
    expect(r).toMatch(/Lab report/);
    expect(r).toMatch(/On your calendar: \*\*Study group\*\*/);
    expect(r.split("On your calendar")[0]).not.toContain("Study group");
  });

  it("an event alone is not 'due'", () => {
    const r = answer("what's due this week?", [study(19)])!;
    expect(r).toMatch(/^Nothing due/);
    expect(r).toMatch(/On your calendar/);
  });
});
