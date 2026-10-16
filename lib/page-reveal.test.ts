import { describe, expect, it } from "vitest";
import { beginPageReveal, endPageReveal, isPageRevealing, revisionOnReveal } from "./page-reveal";

describe("revisionOnReveal", () => {
  const data = { items: [] };
  const ui = { categoryFilter: [] };

  it("keeps the same object when nothing changed, so memo skips the render", () => {
    const previous = { data, ui };
    expect(revisionOnReveal(previous, { data, ui })).toBe(previous);
  });

  it("hands over the current state when items changed off-screen", () => {
    const current = { data: { items: [{ id: "a", status: "done" }] }, ui };
    expect(revisionOnReveal({ data, ui }, current)).toBe(current);
  });

  it("hands over the current state when only the UI store changed", () => {
    const current = { data, ui: { categoryFilter: ["math"] } };
    expect(revisionOnReveal({ data, ui }, current)).toBe(current);
  });
});

describe("page reveal flag", () => {
  it("is raised for the reveal commit and lowered after it", () => {
    expect(isPageRevealing()).toBe(false);
    beginPageReveal();
    expect(isPageRevealing()).toBe(true);
    endPageReveal();
    expect(isPageRevealing()).toBe(false);
  });
});
