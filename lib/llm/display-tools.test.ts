import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATEBOOK_TOOLS, executeDatebookTool } from "./tools";
import type { AssistantReqBody } from "@/lib/assistant-actions";

const NOW = "2026-11-10T23:30:00.000Z";

const body: AssistantReqBody = {
  message: "what is due this week?",
  now: NOW,
  timeZone: "America/New_York",
  categories: [{ id: "chem", name: "CHEM 101" }],
  items: [
    { id: "a", title: "Essay", type: "assignment", at: "2026-11-13T04:59:00.000Z" },
    { id: "b", title: "Lab report", type: "assignment", at: "2026-11-14T04:59:00.000Z" },
  ],
};

const call = (name: string, args: unknown) =>
  executeDatebookTool(name, JSON.stringify(args), { userId: null, threadId: null, body });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

describe("show_items", () => {
  it("hands the app ids to draw as rows, and stages nothing", async () => {
    const out = await call("show_items", { ids: ["a", "b"], heading: "Due this week" });
    expect(out.action).toBeUndefined();
    expect(out.display).toEqual({ items: { ids: ["a", "b"], heading: "Due this week" } });
    expect(out.output).toMatchObject({ ok: true, shown: 2 });
  });

  it("drops ids that are not the user's, rather than drawing them", async () => {
    const out = await call("show_items", { ids: ["a", "someone-elses", "a"] });
    expect(out.display?.items?.ids).toEqual(["a"]);
  });

  it("tells the model when nothing it named exists", async () => {
    const out = await call("show_items", { ids: ["ghost"] });
    expect(out.display).toBeUndefined();
    expect(out.output).toMatchObject({ ok: false });
  });

  it("needs at least one id", async () => {
    await expect(call("show_items", { ids: [] })).rejects.toThrow(/Malformed show_items/);
  });
});

describe("offer_choices", () => {
  it("returns the options for the app to draw as taps", async () => {
    const out = await call("offer_choices", {
      options: ["Advisor meeting", "Study group meeting"],
    });
    expect(out.display).toEqual({ choices: ["Advisor meeting", "Study group meeting"] });
    expect(out.action).toBeUndefined();
  });

  it("needs two to four options", async () => {
    await expect(call("offer_choices", { options: ["Only one"] })).rejects.toThrow(
      /Malformed offer_choices/,
    );
  });
});

describe("tool list", () => {
  it("offers every read tool, and none of them can write", () => {
    const names = DATEBOOK_TOOLS.map((t) => t.function.name);
    expect(names).toEqual(
      expect.arrayContaining(["check_availability", "show_items", "offer_choices"]),
    );
  });
});
