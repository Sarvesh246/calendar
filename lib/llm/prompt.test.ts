import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { systemPrompt } from "./prompt";
import { executeDatebookTool } from "./tools";
import type { AssistantReqBody } from "@/lib/assistant-actions";

// Tuesday Nov 10 2026, 6:30pm in New York.
const NOW = "2026-11-10T23:30:00.000Z";

const body: AssistantReqBody = {
  message: "am I free thursday at 7pm?",
  now: NOW,
  timeZone: "America/New_York",
  clock24h: false,
  weekStartsOn: 0,
  categories: [{ id: "chem", name: "CHEM 101" }],
  items: [
    {
      id: "sg",
      title: "Study group meeting",
      type: "event",
      at: "2026-11-13T00:00:00.000Z", // Thu 7pm
      categoryId: "chem",
    },
    {
      id: "adv",
      title: "Advisor meeting",
      type: "event",
      at: "2026-11-12T20:00:00.000Z", // Thu 3pm — the audit's "Wednesday" mistake
    },
    {
      id: "lab",
      title: "Lab report",
      type: "assignment",
      status: "done",
      at: "2026-11-06T04:59:00.000Z",
      completedAt: "2026-11-05T22:10:00.000Z",
    },
  ],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

describe("system prompt", () => {
  const prompt = systemPrompt(body);

  it("puts the weekday on every snapshot line, so the model copies it", () => {
    expect(prompt).toContain("sg|event||Thu 2026-11-12 19:00||Study group meeting|CHEM 101|");
    expect(prompt).toContain("adv|event||Thu 2026-11-12 15:00|");
  });

  it("hands over a 14-day date table with today and tomorrow marked", () => {
    expect(prompt).toContain("Tue Nov 10 (today), Wed Nov 11 (tomorrow), Thu Nov 12,");
    expect(prompt).toContain("Mon Nov 23");
  });

  it("tells the model to copy weekdays and to call check_availability", () => {
    expect(prompt).toMatch(/never work them out yourself/i);
    expect(prompt).toMatch(/call check_availability/);
  });

  it("says when finished work was finished", () => {
    expect(prompt).toContain("done Thu 2026-11-05 17:10");
  });
});

describe("check_availability tool", () => {
  const run = (start: string, end: string) =>
    executeDatebookTool("check_availability", JSON.stringify({ start, end }), {
      userId: null,
      threadId: null,
      body,
    });

  it("says not free when the 7pm event sits on the window — the audit's wrong 'Yes'", async () => {
    const { output, action } = await run("2026-11-13T00:00:00.000Z", "2026-11-13T00:00:00.000Z");
    expect(action).toBeUndefined();
    expect(output).toMatchObject({
      free: false,
      conflicts: [{ id: "sg", title: "Study group meeting", start: "Thu 2026-11-12 19:00" }],
    });
  });

  it("says free in a gap, and is never a staged change", async () => {
    const { output, action } = await run("2026-11-13T02:00:00.000Z", "2026-11-13T03:00:00.000Z");
    expect(output).toMatchObject({ free: true, conflicts: [] });
    expect(action).toBeUndefined();
  });

  it("rejects a window that is not a date", async () => {
    await expect(run("tomorrow", "later")).rejects.toThrow(/Malformed check_availability/);
  });
});
