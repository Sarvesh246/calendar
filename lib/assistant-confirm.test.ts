import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth-headers", () => ({ authHeaders: async () => ({}) }));
vi.mock("./reminders", () => ({ maybePromptForReminders: async () => {} }));

const { useDatebookStore } = await import("./store");
const { useAssistantSession } = await import("./assistant-session");

const store = () => useDatebookStore.getState();
const NOW = new Date("2026-11-10T23:30:00.000Z");

/** A Canvas-imported assignment: the fields the old server mapping dropped. */
const imported = {
  id: "canvas-1",
  title: "Chem lab report 6",
  type: "assignment" as const,
  at: "2026-11-13T04:59:00.000Z",
  status: "todo" as const,
  categoryId: "chem",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  url: "https://canvas.example/courses/1/assignments/6",
  sourceId: "src-1",
  sourceUid: "event-assignment-6",
};

function stageCard(action: Record<string, unknown>) {
  useAssistantSession.setState({
    messages: [
      { role: "assistant", text: "ok", actions: [action as never], createdAt: Date.now() },
    ],
  });
}

function confirmReturns(body: Record<string, unknown>, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, json: async () => body })),
  );
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  useDatebookStore.setState({
    items: [{ ...imported }],
    categories: [
      { id: "chem", name: "CHEM 101", color: "#007AFF" },
      { id: "pols", name: "POLS 207", color: "#34C759" },
    ],
    deletions: {},
    lastDeleted: null,
    mode: "local",
    userId: null,
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("applying a server-confirmed action", () => {
  it("an assistant edit keeps the imported item's link and source ids", async () => {
    confirmReturns({
      tool: "update_task",
      arguments: { id: "canvas-1", due: "2026-11-14T04:59:00.000Z" },
    });
    stageCard({
      kind: "update",
      summary: "Update",
      itemId: "canvas-1",
      itemTitle: imported.title,
      patch: { at: "2026-11-14T04:59:00.000Z" },
      serverActionId: "c1",
    });
    useAssistantSession.getState().applyAction(0, 0);
    await settled();
    const item = store().items.find((i) => i.id === "canvas-1")!;
    expect(item.at).toBe("2026-11-14T04:59:00.000Z");
    // The old lossy mapping dropped these, and import de-duplication then
    // re-added the item.
    expect(item.url).toBe(imported.url);
    expect(item.sourceId).toBe("src-1");
    expect(item.sourceUid).toBe("event-assignment-6");
    expect(useAssistantSession.getState().messages[0].resolved).toEqual({ 0: "applied" });
  });

  it("goes through updateItem, so the write is stamped for last-write-wins", async () => {
    confirmReturns({ tool: "update_task", arguments: { id: "canvas-1", title: "Lab 6" } });
    stageCard({
      kind: "update",
      summary: "",
      itemId: "canvas-1",
      itemTitle: imported.title,
      patch: { title: "Lab 6" },
      serverActionId: "c1",
    });
    useAssistantSession.getState().applyAction(0, 0);
    await settled();
    const item = store().items[0];
    expect(item.title).toBe("Lab 6");
    expect(item.updatedAt).toBe(NOW.toISOString());
  });

  it("a delete leaves a tombstone and an Undo, like the on-device engine", async () => {
    confirmReturns({ tool: "delete_task", arguments: { id: "canvas-1" } });
    stageCard({
      kind: "delete",
      summary: "",
      itemId: "canvas-1",
      itemTitle: imported.title,
      serverActionId: "c1",
    });
    useAssistantSession.getState().applyAction(0, 0);
    await settled();
    expect(store().items).toEqual([]);
    expect(Object.keys(store().deletions).length).toBeGreaterThan(0);
    expect(store().lastDeleted?.items[0].id).toBe("canvas-1");
  });

  it("an add is created by addItem and filed under the class the card showed", async () => {
    confirmReturns({
      tool: "add_event",
      arguments: { title: "Study group", start: "2026-11-13T00:00:00.000Z", categoryId: "chem" },
    });
    stageCard({
      kind: "create",
      summary: "",
      // The user changed the chip from CHEM to POLS before tapping Add.
      draft: {
        title: "Study group",
        type: "event",
        categoryId: "pols",
        at: "2026-11-13T00:00:00.000Z",
      },
      serverActionId: "c1",
    });
    useAssistantSession.getState().applyAction(0, 0);
    await settled();
    const created = store().items.find((i) => i.title === "Study group")!;
    expect(created.categoryId).toBe("pols");
    expect(created.createdAt).toBeTruthy();
  });

  it("a server refusal because the item is gone resolves the card as stale", async () => {
    confirmReturns({ error: "This item no longer exists" }, false);
    stageCard({
      kind: "update",
      summary: "",
      itemId: "canvas-1",
      itemTitle: imported.title,
      patch: { title: "x" },
      serverActionId: "c1",
    });
    useAssistantSession.getState().applyAction(0, 0);
    await settled();
    expect(useAssistantSession.getState().messages[0].resolved).toEqual({ 0: "stale" });
    expect(store().items[0].title).toBe(imported.title);
  });

  it("a card for an item deleted in the meantime is stale without asking the server", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    useDatebookStore.setState({ items: [] });
    stageCard({
      kind: "update",
      summary: "",
      itemId: "canvas-1",
      itemTitle: imported.title,
      patch: { title: "x" },
      serverActionId: "c1",
    });
    useAssistantSession.getState().applyAction(0, 0);
    await settled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(useAssistantSession.getState().messages[0].resolved).toEqual({ 0: "stale" });
  });
});
