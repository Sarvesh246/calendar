import { describe, expect, it } from "vitest";
import {
  ACTION_TTL_MS,
  actionTargetId,
  staleReason,
  supersedeOpenCards,
} from "./assistant-staleness";
import type { AssistantAction } from "./ai-assistant";

const rename: AssistantAction = {
  kind: "update",
  summary: "Update “Gym”",
  itemId: "gym",
  itemTitle: "Gym",
  patch: { title: "Gym time" },
};
const remove: AssistantAction = {
  kind: "delete",
  summary: "Delete “Gym”",
  itemId: "gym",
  itemTitle: "Gym",
};
const create: AssistantAction = {
  kind: "create",
  summary: "Add “Lunch”",
  draft: { title: "Lunch", type: "event", categoryId: "c1", at: "2026-11-12T12:00:00.000Z" },
};

describe("stale cards", () => {
  const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);

  it("a card for an item that is gone is stale, not done", () => {
    // Ask to rename Gym (card left open), delete Gym, then tap Rename.
    expect(staleReason(rename, NOW - 1000, () => false, NOW)).toBe("stale");
    expect(staleReason(remove, NOW - 1000, () => false, NOW)).toBe("stale");
  });

  it("a card whose item still exists can be applied", () => {
    expect(staleReason(rename, NOW - 1000, (id) => id === "gym", NOW)).toBeNull();
  });

  it("a create card never goes stale because of the items", () => {
    expect(staleReason(create, NOW - 1000, () => false, NOW)).toBeNull();
  });

  it("expires after 30 minutes, to match the server", () => {
    expect(staleReason(create, NOW - ACTION_TTL_MS + 1000, () => true, NOW)).toBeNull();
    expect(staleReason(create, NOW - ACTION_TTL_MS - 1000, () => true, NOW)).toBe("expired");
  });

  it("old messages with no timestamp are left alone", () => {
    expect(staleReason(create, undefined, () => true, NOW)).toBeNull();
  });

  it("names the target of update and delete only", () => {
    expect(actionTargetId(rename)).toBe("gym");
    expect(actionTargetId(remove)).toBe("gym");
    expect(actionTargetId(create)).toBeNull();
  });
});

describe("superseding open cards", () => {
  const messages = [
    { actions: [rename], resolved: undefined },
    { actions: [create], resolved: undefined },
    { actions: [rename], resolved: { 0: "applied" as const } },
    { actions: undefined, resolved: undefined },
  ];

  it("marks an older open card for the same item as superseded", () => {
    const next = supersedeOpenCards(messages, [remove]);
    expect(next[0].resolved).toEqual({ 0: "superseded" });
  });

  it("leaves other items, creates and already-resolved cards alone", () => {
    const next = supersedeOpenCards(messages, [remove]);
    expect(next[1]).toBe(messages[1]);
    expect(next[2].resolved).toEqual({ 0: "applied" });
    expect(next[3]).toBe(messages[3]);
  });

  it("does nothing for a reply with no targets", () => {
    expect(supersedeOpenCards(messages, [create])).toBe(messages);
    expect(supersedeOpenCards(messages, undefined)).toBe(messages);
  });
});
