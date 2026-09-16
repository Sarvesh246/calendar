import { describe, expect, it } from "vitest";
import { skipNextPageEnter, takeSkipPageEnter } from "./page-enter";

describe("skipNextPageEnter", () => {
  it("is consumed once so a later tap can still animate", () => {
    skipNextPageEnter();
    expect(takeSkipPageEnter()).toBe(true);
    expect(takeSkipPageEnter()).toBe(false);
  });
});
