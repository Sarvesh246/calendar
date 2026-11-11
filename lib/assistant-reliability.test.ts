import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextUsHoliday } from "./local-math";
import { resetLocalAssistantState, tryLocalAnswer } from "./local-assistant";
import { mergeCooldowns } from "./llm/cooldown-store";
import type { AssistantCtx } from "./ai-assistant";

vi.mock("server-only", () => ({}));
vi.mock("./auth-headers", () => ({ authHeaders: async () => ({}) }));
vi.mock("./reminders", () => ({ maybePromptForReminders: async () => {} }));

// Tuesday, Nov 10 2026.
const NOW = new Date(2026, 10, 10, 10, 0, 0);
const ctx: AssistantCtx = { items: [], categories: [], clock24h: false, weekStartsOn: 0 };

beforeEach(() => {
  resetLocalAssistantState();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("US holidays", () => {
  it("computes nth-weekday holidays for the year", () => {
    expect(nextUsHoliday("thanksgiving", NOW)?.date).toEqual(new Date(2026, 10, 26));
    expect(nextUsHoliday("memorial day", new Date(2026, 0, 1))?.date).toEqual(
      new Date(2026, 4, 25),
    );
    expect(nextUsHoliday("labor day", new Date(2026, 0, 1))?.date).toEqual(new Date(2026, 8, 7));
    expect(nextUsHoliday("easter", new Date(2026, 0, 1))?.date).toEqual(new Date(2026, 3, 5));
  });

  it("rolls to next year once it has passed, but counts today", () => {
    expect(nextUsHoliday("veterans day", new Date(2026, 10, 12))?.date).toEqual(
      new Date(2027, 10, 11),
    );
    expect(nextUsHoliday("veterans day", new Date(2026, 10, 11, 9))?.date).toEqual(
      new Date(2026, 10, 11),
    );
    expect(nextUsHoliday("not a holiday", NOW)).toBeNull();
  });

  it("answers 'how many days until thanksgiving' on-device", () => {
    const r = tryLocalAnswer("how many days until thanksgiving", [], ctx, NOW);
    expect(r?.text).toContain("16 days");
    expect(r?.text).toContain("Thanksgiving");
  });
});

describe("typos", () => {
  it("understands 'whats du tmrw' without the model", () => {
    const r = tryLocalAnswer("whats du tmrw", [], ctx, NOW);
    expect(r).not.toBeNull();
    expect(r?.text).toMatch(/nothing is due tomorrow/i);
  });
});

describe("provider cooldowns survive a cold start", () => {
  it("takes the later of this instance's view and the durable store's", () => {
    const merged = mergeCooldowns(
      new Map([
        ["groq", 100],
        ["gemini", 500],
      ]),
      new Map([
        ["groq", 900],
        ["gemini", 200],
        ["other", 50],
      ]),
    );
    expect(Object.fromEntries(merged)).toEqual({ groq: 900, gemini: 500, other: 50 });
  });
});

describe("queued messages and undo", () => {
  it("queues several follow-ups in order rather than keeping only the last", async () => {
    const { useAssistantSession } = await import("./assistant-session");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    useAssistantSession.setState({ messages: [], queued: [], thinking: false });
    useAssistantSession.getState().ask("hmm, which of my classes is hardest");
    useAssistantSession.getState().ask("first queued");
    useAssistantSession.getState().ask("second queued");
    expect(useAssistantSession.getState().queued).toEqual(["first queued", "second queued"]);
    vi.unstubAllGlobals();
  });
});
