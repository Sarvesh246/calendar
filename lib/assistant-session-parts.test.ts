import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth-headers", () => ({ authHeaders: async () => ({}) }));
vi.mock("./reminders", () => ({ maybePromptForReminders: async () => {} }));

const { useDatebookStore } = await import("./store");
const { useAssistantSession } = await import("./assistant-session");

const NOW = new Date("2026-11-10T23:30:00.000Z");
const session = () => useAssistantSession.getState();

const item = (id: string, title: string) => ({
  id,
  title,
  type: "assignment" as const,
  at: "2026-11-13T04:59:00.000Z",
  status: "todo" as const,
  categoryId: "chem",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  useDatebookStore.setState({
    items: [item("a", "Essay"), item("b", "Lab report")],
    categories: [{ id: "chem", name: "CHEM 101", color: "#007AFF" }],
    deletions: {},
    lastDeleted: null,
    mode: "local",
    userId: null,
  });
});
afterEach(() => vi.useRealTimers());

describe("batch confirm", () => {
  const rename = (id: string, title: string) => ({
    kind: "update" as const,
    summary: "",
    itemId: id,
    itemTitle: id === "a" ? "Essay" : "Lab report",
    patch: { title },
  });

  it("Confirm all applies every open card and leaves resolved ones alone", () => {
    useAssistantSession.setState({
      messages: [
        {
          role: "assistant",
          text: "Here is what I will do.",
          actions: [rename("a", "Essay 2"), rename("b", "Lab 2")],
          resolved: { 1: "dismissed" },
          createdAt: Date.now(),
        },
      ],
    });
    session().applyAll(0);
    const titles = useDatebookStore.getState().items.map((i) => i.title);
    expect(titles).toEqual(["Essay 2", "Lab report"]); // the dismissed one stays dismissed
    expect(session().messages[0].resolved).toEqual({ 0: "applied", 1: "dismissed" });
  });
});

describe("a card that no longer applies", () => {
  it("an item deleted by an earlier card makes the later card stale, not Done", () => {
    useAssistantSession.setState({
      messages: [
        {
          role: "assistant",
          text: "Two changes.",
          actions: [
            { kind: "delete", summary: "", itemId: "a", itemTitle: "Essay" },
            {
              kind: "update",
              summary: "",
              itemId: "a",
              itemTitle: "Essay",
              patch: { title: "Essay 2" },
            },
          ],
          createdAt: Date.now(),
        },
      ],
    });
    session().applyAll(0);
    expect(session().messages[0].resolved).toEqual({ 0: "applied", 1: "stale" });
    expect(useDatebookStore.getState().items.map((i) => i.id)).toEqual(["b"]);
  });
});
