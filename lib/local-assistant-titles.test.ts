import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLocalAssistantState, tryLocalAnswer } from "./local-assistant";
import type { AssistantCtx } from "./ai-assistant";

// Tuesday, Nov 10 2026, 10:00 local — pinned so "friday" is the 13th.
const NOW = new Date(2026, 10, 10, 10, 0, 0);

const ctx: AssistantCtx = {
  items: [],
  categories: [
    { id: "math", name: "MATH 150", color: "#007AFF" },
    { id: "chem", name: "CHEM 101", color: "#34C759" },
  ],
  clock24h: false,
  weekStartsOn: 0,
};

beforeEach(() => {
  resetLocalAssistantState();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const ask = (q: string) => tryLocalAnswer(q, [], ctx, NOW);

describe("on-device add titles", () => {
  it("drops 'due' and 'for <class>' once the class has been matched", () => {
    const r = ask("add ZZTEST calc homework due friday 11:59pm for math")!;
    expect(r.actions?.[0]).toMatchObject({
      kind: "create",
      draft: { title: "ZZTEST calc homework", categoryId: "math" },
    });
  });

  it("leaves a title alone when 'for' is part of what it says", () => {
    const r = ask("add gift for mom friday 5pm");
    // Not a class: whatever the engine does, the words are not thrown away.
    if (r?.actions?.[0]?.kind === "create") {
      expect(r.actions[0].draft.title.toLowerCase()).toContain("for mom");
    }
  });
});
