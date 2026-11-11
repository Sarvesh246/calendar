import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLocalAssistantState, tryLocalAnswer } from "./local-assistant";
import type { AssistantCtx } from "./ai-assistant";

vi.mock("server-only", () => ({}));
vi.mock("./auth-headers", () => ({ authHeaders: async () => ({}) }));
vi.mock("./reminders", () => ({ maybePromptForReminders: async () => {} }));

const { useDatebookStore } = await import("./store");
const { useAssistantSession } = await import("./assistant-session");

const NOW = new Date(2026, 10, 10, 10, 0, 0);
const store = () => useDatebookStore.getState();
const session = () => useAssistantSession.getState();

const gym = {
  id: "gym",
  title: "Gym",
  type: "event" as const,
  at: new Date(2026, 10, 12, 18).toISOString(),
  endAt: new Date(2026, 10, 12, 19).toISOString(),
  location: "Rec center",
  categoryId: "c",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

function card(action: Record<string, unknown>) {
  useAssistantSession.setState({
    messages: [
      { role: "assistant", text: "ok", actions: [action as never], createdAt: Date.now() },
    ],
    queued: [],
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  useDatebookStore.setState({
    items: [{ ...gym }],
    categories: [{ id: "c", name: "CHEM 101", color: "#007AFF" }],
    deletions: {},
    lastDeleted: null,
    mode: "local",
    userId: null,
  });
});
afterEach(() => vi.useRealTimers());

describe("undo", () => {
  it("puts back exactly the fields an update changed", () => {
    card({
      kind: "update",
      summary: "",
      itemId: "gym",
      itemTitle: "Gym",
      patch: { title: "Gym time", location: undefined },
    });
    session().applyAction(0, 0);
    expect(store().items[0]).toMatchObject({ title: "Gym time" });
    expect(store().items[0].location).toBeUndefined();
    session().undoAction(0, 0);
    expect(store().items[0]).toMatchObject({ title: "Gym", location: "Rec center" });
    expect(session().messages[0].resolved).toEqual({ 0: "undone" });
  });

  it("undoes an add by removing what it created", () => {
    card({
      kind: "create",
      summary: "",
      draft: { title: "Lunch", type: "event", categoryId: "c", at: gym.at },
    });
    session().applyAction(0, 0);
    expect(store().items.map((i) => i.title)).toContain("Lunch");
    session().undoAction(0, 0);
    expect(store().items.map((i) => i.title)).toEqual(["Gym"]);
  });

  it("undoes a delete through the store's own Undo", () => {
    card({ kind: "delete", summary: "", itemId: "gym", itemTitle: "Gym" });
    session().applyAction(0, 0);
    expect(store().items).toEqual([]);
    session().undoAction(0, 0);
    expect(store().items.map((i) => i.id)).toEqual(["gym"]);
  });

  it("'undo that' reverses the latest change without asking a model", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    card({
      kind: "update",
      summary: "",
      itemId: "gym",
      itemTitle: "Gym",
      patch: { title: "Gym time" },
    });
    session().applyAction(0, 0);
    session().ask("undo that");
    expect(store().items[0].title).toBe("Gym");
    const last = session().messages.at(-1)!;
    expect(last.text).toMatch(/^Undid /);
    expect(fetchSpy).not.toHaveBeenCalled();
    session().ask("undo that");
    expect(session().messages.at(-1)!.text).toMatch(/nothing to undo/i);
    vi.unstubAllGlobals();
  });
});

describe("queue", () => {
  it("sends queued follow-ups one after another, in order", async () => {
    vi.useRealTimers();
    const asked: string[] = [];
    let release: (() => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        asked.push((JSON.parse(init.body) as { message: string }).message);
        await new Promise<void>((resolve) => (release = resolve));
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ text: "ok" }),
        };
      }),
    );
    useAssistantSession.setState({ messages: [], queued: [], thinking: false });
    session().ask("should I study for my exam or finish the essay?");
    session().ask("why is my calendar so full");
    session().ask("xyzzy plugh");
    expect(session().queued).toHaveLength(2);
    // Release each reply once its request has been made.
    for (let i = 1; i <= 3; i += 1) {
      for (let waited = 0; asked.length < i && waited < 1000; waited += 10) {
        await new Promise((r) => setTimeout(r, 10));
      }
      release?.();
    }
    await new Promise((r) => setTimeout(r, 60));
    expect(asked).toEqual([
      "should I study for my exam or finish the essay?",
      "why is my calendar so full",
      "xyzzy plugh",
    ]);
    expect(session().queued).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe("holiday phrasings", () => {
  const ctx: AssistantCtx = { items: [], categories: [], clock24h: false, weekStartsOn: 0 };
  beforeEach(() => resetLocalAssistantState());
  it.each([
    "how many days until thanksgiving",
    "days till christmas",
    "how many weeks until memorial day",
  ])("%s is answered on-device", (q) => {
    expect(tryLocalAnswer(q, [], ctx, NOW)?.text).toBeTruthy();
  });
});
