import { describe, expect, it } from "vitest";
import { describeEmptyState } from "./empty-state-copy";

const base = { scope: "today", total: 0, hiddenByCategory: 0, hiddenByCompletion: 0 };

describe("describeEmptyState", () => {
  it("says nothing is scheduled when the scope is genuinely empty", () => {
    const copy = describeEmptyState(base);
    expect(copy.kind).toBe("nothing");
    expect(copy.title).toBe("Nothing scheduled.");
    expect(copy.action).toBe(null);
  });

  it("offers an add affordance on a day you can add to", () => {
    const copy = describeEmptyState({ ...base, scope: "Mar 3", canAdd: true });
    expect(copy.action).toBe("add");
    expect(copy.sub).toContain("Mar 3");
  });

  it("celebrates a finished day rather than blaming the filter", () => {
    const copy = describeEmptyState({
      ...base,
      total: 4,
      hiddenByCompletion: 4,
    });
    expect(copy.kind).toBe("done");
    expect(copy.title).toBe("Everything completed.");
    expect(copy.sub).toBe("All 4 things on today are finished.");
    expect(copy.action).toBe("show-completed");
  });

  it("uses singular wording for one finished thing", () => {
    const copy = describeEmptyState({ ...base, total: 1, hiddenByCompletion: 1 });
    expect(copy.title).toBe("All done.");
    expect(copy.sub).toBe("The one thing on today is finished.");
  });

  it("blames the class filter when that is what emptied the list", () => {
    const copy = describeEmptyState({ ...base, total: 3, hiddenByCategory: 3 });
    expect(copy.kind).toBe("filtered");
    expect(copy.title).toBe("Nothing matches your filters.");
    expect(copy.sub).toBe("3 things on today — 3 hidden by the class filter.");
    expect(copy.action).toBe("clear-filters");
  });

  it("accounts for both filters when both are hiding things", () => {
    const copy = describeEmptyState({
      ...base,
      total: 5,
      hiddenByCategory: 3,
      hiddenByCompletion: 2,
    });
    expect(copy.kind).toBe("filtered");
    expect(copy.sub).toBe(
      "5 things on today — 3 hidden by the class filter, 2 already completed."
    );
  });

  it("prefers the filter explanation when a class filter is also in play", () => {
    // Everything left is done, but a class filter is on too — offering only
    // "show completed" would leave the real cause switched on.
    const copy = describeEmptyState({
      ...base,
      total: 4,
      hiddenByCategory: 1,
      hiddenByCompletion: 3,
    });
    expect(copy.kind).toBe("filtered");
    expect(copy.action).toBe("clear-filters");
  });
});

describe("describeEmptyState with a saved view", () => {
  it("names the view as a reason things are missing", () => {
    const copy = describeEmptyState({ ...base, total: 4, hiddenByView: 4 });
    expect(copy.kind).toBe("filtered");
    expect(copy.sub).toBe("4 things on today — 4 outside your saved view.");
  });

  it("does not celebrate a finished day when a view is also hiding things", () => {
    const copy = describeEmptyState({
      ...base,
      total: 4,
      hiddenByCompletion: 3,
      hiddenByView: 1,
    });
    expect(copy.kind).toBe("filtered");
    expect(copy.action).toBe("clear-filters");
  });

  it("still celebrates when completion is the only cause", () => {
    const copy = describeEmptyState({
      ...base,
      total: 3,
      hiddenByCompletion: 3,
      hiddenByView: 0,
    });
    expect(copy.kind).toBe("done");
  });
});
