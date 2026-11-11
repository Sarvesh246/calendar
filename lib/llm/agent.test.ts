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

  it("asks only once: a second miss goes through rather than looping", async () => {
    script.push(
      call("add_event", { title: "dentist", start: "2026-11-17T15:00:00-05:00" }),
      call("add_event", { title: "dentist", start: "2026-11-17T15:00:00-05:00" }),
    );
    const { result } = await run(msg);
    expect(seen).toHaveLength(2);
    expect(result.actions).toHaveLength(1);
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
    expect(String(toolMessage.content)).toMatch(/repeat\.until/);
    expect(result.actions).toEqual([]);
  });
});
