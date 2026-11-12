import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantReqBody } from "@/lib/assistant-actions";
import { normalizeActions } from "@/lib/assistant-actions";
import type { ChatMessage } from "./openai-compatible";

/** The model is scripted; everything else in the agent loop is the real code. */
const script: ChatMessage[] = [];
const seen: ChatMessage[][] = [];
vi.mock("./router", () => ({
  createChatCompletion: vi.fn(async (opts: { messages: ChatMessage[] }) => {
    seen.push(opts.messages.map((m) => ({ ...m })));
    const message = script.shift();
    if (!message) throw new Error("script exhausted");
    return { message, latencyMs: 1 };
  }),
}));

const { runAgent } = await import("./agent");

const NOW = "2026-11-10T23:30:00.000Z";

const call = (name: string, args: unknown, id = "c1"): ChatMessage => ({
  role: "assistant",
  content: null,
  tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
});
const say = (content: string): ChatMessage => ({ role: "assistant", content });

function bodyFor(message: string, items: AssistantReqBody["items"] = []): AssistantReqBody {
  return {
    message,
    now: NOW,
    timeZone: "America/New_York",
    categories: [{ id: "chem", name: "CHEM 101" }],
    items,
    itemCount: items.length,
  };
}

function run(message: string, items: AssistantReqBody["items"] = []) {
  const body = bodyFor(message, items);
  return runAgent({
    provider: {} as never,
    key: "k",
    messages: [{ role: "user", content: message }],
    userId: null,
    threadId: null,
    body,
    budget: { left: 4 },
  }).then((result) => ({ result, body }));
}

beforeEach(() => {
  script.length = 0;
  seen.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

describe("completeness check", () => {
  const msg = "dentist next tuesday 3pm at the clinic on main st";

  it("sends one correction when the location was dropped, then accepts the fix", async () => {
    script.push(
      call("add_event", { title: "dentist", start: "2026-11-17T15:00:00-05:00" }),
      call("add_event", {
        title: "dentist",
        start: "2026-11-17T15:00:00-05:00",
        location: "The clinic on Main St",
      }),
    );
    const { result, body } = await run(msg);
    expect(seen).toHaveLength(2);
    // The model was told what it dropped, in place of an "ok".
    const second = seen[1].filter((m) => m.role === "tool").at(-1)!;
    expect(String(second.content)).toMatch(/location \\"the clinic on main st\\"/);
    expect(String(second.content)).toMatch(/Nothing was staged/);
    // Only the corrected add survives, with its location and a tidy title.
    expect(result.actions).toHaveLength(1);
    const [action] = normalizeActions(result.actions, body);
    expect(action).toMatchObject({
      kind: "create",
      draft: { title: "Dentist", location: "The clinic on Main St" },
    });
  });

  it("asks for clarification when a second attempt still misses details", async () => {
    script.push(
      call("add_event", { title: "dentist", start: "2026-11-17T15:00:00-05:00" }),
      call("add_event", { title: "dentist", start: "2026-11-17T15:00:00-05:00" }),
    );
    const { result } = await run(msg);
    expect(seen).toHaveLength(2);
    expect(result.actions).toHaveLength(0);
    expect(result.text).toContain("clarify");
  });

  it("does not interrupt a complete add", async () => {
    script.push(
      call("add_event", {
        title: "Dentist",
        start: "2026-11-17T15:00:00-05:00",
        location: "the clinic on main st",
      }),
    );
    await run(msg);
    expect(seen).toHaveLength(1);
  });
});

describe("duplicate hint", () => {
  const existing = [
    {
      id: "sg",
      title: "Study group meeting",
      type: "event" as const,
      at: "2026-11-13T00:00:00.000Z",
    },
  ];

  it("stages nothing when the same thing is already there, and lets the model ask", async () => {
    script.push(
      call("add_event", { title: "Study group", start: "2026-11-12T19:00:00-05:00" }),
      say("Study group meeting is already on Thu, Nov 12 at 7:00 PM. Add another?"),
    );
    const { result } = await run("add study group thursday 7pm", existing);
    expect(result.actions).toEqual([]);
    const toolMessage = seen[1].filter((m) => m.role === "tool").at(-1)!;
    expect(String(toolMessage.content)).toMatch(/possibleDuplicate/);
    expect(result.text).toMatch(/already/);
  });

  it("stages the copy once the user has said yes", async () => {
    script.push(
      call("add_event", {
        title: "Study group",
        start: "2026-11-12T19:00:00-05:00",
        allowDuplicate: true,
      }),
    );
    const { result } = await run("yes, add another study group at 7pm thursday", existing);
    expect(result.actions).toHaveLength(1);
  });
});

describe("repeating adds", () => {
  const rule = { freq: "weekly", byDay: [1, 3], until: "2026-11-30T23:59:00-05:00" };

  it("one add_event with a repeat becomes one series, not many events", async () => {
    script.push(
      call("add_event", {
        title: "gym",
        start: "2026-11-11T06:00:00-05:00",
        repeat: rule,
      }),
    );
    const { result, body } = await run("gym every monday and wednesday at 6am until nov 30");
    expect(result.actions).toHaveLength(1);
    const [action] = normalizeActions(result.actions, body);
    expect(action).toMatchObject({
      kind: "create",
      draft: {
        title: "Gym",
        repeat: { freq: "weekly", byDay: [1, 3], until: "2026-12-01T04:59:00.000Z" },
      },
    });
  });

  it("a repeat with no end date is refused, so the model asks until when", async () => {
    script.push(
      call("add_event", {
        title: "gym",
        start: "2026-11-11T06:00:00-05:00",
        repeat: { freq: "weekly", byDay: [1, 3] },
      }),
      say("Until when should the gym repeat?"),
    );
    const { result } = await run("gym every monday and wednesday at 6am");
    // The malformed-arguments retry carries the reason back to the model.
    const toolMessage = seen[1].filter((m) => m.role === "tool").at(-1)!;
    expect(String(toolMessage.content)).toMatch(/series end date/i);
    expect(result.actions).toEqual([]);
  });
});

describe("event wall times", () => {
  it("stages one inclusive all-day range across a timezone change", async () => {
    script.push(
      call("add_event", {
        title: "Conference",
        startDate: "2026-10-31",
        endDate: "2026-11-02",
        allDay: true,
      }),
    );
    const { result, body } = await run("add conference october 31 through november 2 all day");
    const [action] = normalizeActions(result.actions, body);
    expect(action).toMatchObject({
      kind: "create",
      draft: { at: "2026-10-31T04:00:00.000Z", endAt: "2026-11-03T05:00:00.000Z", allDay: true },
    });
  });
  it("rejects an end before the start", async () => {
    script.push(
      call("add_event", {
        title: "Meeting",
        startDate: "2026-11-12",
        startTime: "15:00",
        endTime: "14:00",
      }),
      say("When should it end?"),
    );
    const { result } = await run("add meeting november 12");
    expect(result.actions).toHaveLength(0);
    expect(result.text).toContain("end");
  });
});

it("links a planned work session without changing its deadline", async () => {
  const task = {
    id: "essay",
    title: "Essay",
    type: "assignment" as const,
    at: "2026-11-20T23:59:00Z",
    status: "todo" as const,
  };
  script.push(
    call("add_event", {
      title: "Work on Essay",
      startDate: "2026-11-12",
      startTime: "15:00",
      endTime: "16:00",
      workFor: "essay",
    }),
  );
  const { result, body } = await run("plan work on my essay november 12 3pm to 4pm", [task]);
  expect(normalizeActions(result.actions, body)[0]).toMatchObject({
    kind: "create",
    draft: { workFor: "essay" },
  });
});

it("replaces a pending all-day range without applying it", async () => {
  script.push(call("revise_pending", { ref: "1:0", endDate: "2026-11-16" }));
  const body = bodyFor("actually make it end november 16");
  body.pendingCreates = [
    {
      ref: "1:0",
      draft: {
        title: "Hackathon",
        type: "event",
        categoryId: "",
        at: "2026-11-14T05:00:00Z",
        endAt: "2026-11-16T05:00:00Z",
        allDay: true,
      },
    },
  ];
  const result = await runAgent({
    provider: {} as never,
    key: "k",
    messages: [],
    userId: null,
    threadId: null,
    body,
    budget: { left: 4 },
  });
  expect(normalizeActions(result.actions, body)[0]).toMatchObject({
    kind: "create",
    revisionOf: "1:0",
    draft: { endAt: "2026-11-17T05:00:00.000Z" },
  });
});

it("updates an event using local wall time", async () => {
  const meeting = {
    id: "m1",
    title: "Meeting",
    type: "event" as const,
    at: "2026-11-14T15:00:00Z",
    endAt: "2026-11-14T16:00:00Z",
  };
  script.push(
    call("update_event", {
      id: "m1",
      startDate: "2026-11-15",
      startTime: "10:00",
      endDate: "2026-11-15",
      endTime: "11:00",
    }),
  );
  const { result, body } = await run("move meeting to november 15 10am to 11am", [meeting]);
  expect(normalizeActions(result.actions, body)[0]).toMatchObject({
    kind: "update",
    patch: { at: "2026-11-15T15:00:00.000Z", endAt: "2026-11-15T16:00:00.000Z" },
  });
});

it("stages every bulk shift for confirmation", async () => {
  const events = [
    {
      id: "a",
      title: "A",
      type: "event" as const,
      at: "2026-11-14T15:00:00Z",
      endAt: "2026-11-14T16:00:00Z",
    },
    { id: "b", title: "B", type: "task" as const, at: "2026-11-15T15:00:00Z" },
  ];
  script.push(call("bulk_shift", { ids: ["a", "b"], minutes: 60 }));
  const { result, body } = await run("move both an hour later", events);
  expect(normalizeActions(result.actions, body)).toMatchObject([
    {
      kind: "update",
      patch: { at: "2026-11-14T16:00:00.000Z", endAt: "2026-11-14T17:00:00.000Z" },
    },
    { kind: "update", patch: { at: "2026-11-15T16:00:00.000Z" } },
  ]);
});

it("resolves a filtered set before staging a bulk update", async () => {
  const tasks = [
    { id: "a", title: "A", type: "task" as const, at: "2026-11-14T15:00:00Z", categoryId: "chem" },
    { id: "b", title: "B", type: "task" as const, at: "2026-11-15T15:00:00Z", categoryId: "pols" },
  ];
  script.push(
    call("select_items", { categoryId: "chem", status: "todo" }),
    call("bulk_update", { ids: ["a"], status: "done" }),
  );
  const { result, body } = await run("mark chem tasks done", tasks);
  const selection = seen[1].find((m) => m.role === "tool");
  expect(String(selection?.content)).toContain('"a"');
  expect(String(selection?.content)).not.toContain('"b"');
  expect(normalizeActions(result.actions, body)).toMatchObject([
    { kind: "update", itemId: "a", patch: { status: "done" } },
  ]);
});

it("stages an undated task without inventing a deadline", async () => {
  script.push(call("add_task", { title: "Read paper", undated: true }));
  const { result, body } = await run("add a task to read paper with no due date");
  expect(normalizeActions(result.actions, body)).toMatchObject([
    { kind: "create", draft: { type: "task", at: "9999-12-31T12:00:00.000Z", reminders: [] } },
  ]);
});

it("rejects a nonexistent daylight-saving wall time", async () => {
  script.push(
    call("add_event", { title: "Meeting", startDate: "2027-03-14", startTime: "02:30" }),
    say("That time doesn't exist. What time should I use?"),
  );
  const { result } = await run("add meeting march 14 at 2:30am");
  expect(result.actions).toEqual([]);
  expect(result.text).toContain("time");
});

it("shifts a complete weekly series by a day across daylight saving", async () => {
  const repeat = { freq: "weekly" as const, byDay: [6], until: "2027-03-14T04:59:00Z" };
  const events = [
    {
      id: "a",
      title: "Class",
      type: "event" as const,
      at: "2027-03-06T14:00:00Z",
      endAt: "2027-03-06T15:00:00Z",
      repeat,
      repeatId: "s",
    },
    {
      id: "b",
      title: "Class",
      type: "event" as const,
      at: "2027-03-13T14:00:00Z",
      endAt: "2027-03-13T15:00:00Z",
      repeat,
      repeatId: "s",
    },
  ];
  script.push(call("bulk_shift", { ids: ["a", "b"], minutes: 1440 }));
  const { result, body } = await run("move the whole class series one day later", events);
  const actions = normalizeActions(result.actions, body);
  expect(actions).toHaveLength(1);
  expect(actions[0].kind).toBe("batch");
  if (actions[0].kind !== "batch") return;
  expect(actions[0].actions[1]).toMatchObject({
    kind: "update",
    patch: {
      at: "2027-03-14T13:00:00.000Z",
      endAt: "2027-03-14T14:00:00.000Z",
      repeat: { byDay: [0], until: "2027-03-15T03:59:00.000Z" },
    },
  });
});

it("stages weekly class meetings with a local series end date", async () => {
  script.push(
    call("add_event", {
      title: "CHEM lecture",
      categoryId: "chem",
      startDate: "2026-11-16",
      startTime: "10:00",
      endTime: "11:00",
      repeat: { freq: "weekly", byDay: [1, 3], untilDate: "2026-12-02" },
    }),
  );
  const { result, body } = await run(
    "add CHEM lecture mondays and wednesdays 10am to 11am until december 2",
  );
  expect(normalizeActions(result.actions, body)).toMatchObject([
    {
      kind: "create",
      draft: {
        categoryId: "chem",
        repeat: { freq: "weekly", byDay: [1, 3], until: "2026-12-03T04:59:00.000Z" },
      },
    },
  ]);
});
