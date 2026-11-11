import { describe, expect, it } from "vitest";
import {
  buildParts,
  cleanChoices,
  cleanItemsBlocks,
  historyText,
  partsOf,
} from "./assistant-parts";
import { polishReply } from "./assistant-polish";

describe("buildParts", () => {
  it("orders text, rows, notice, cards, then choices", () => {
    const parts = buildParts({
      text: "Here is what is due.",
      items: [{ ids: ["a", "b"], heading: "This week" }],
      fallbackNotice: "Used another model.",
      actions: [{}, {}],
      choices: ["Advisor meeting", "Study group meeting"],
    });
    expect(parts.map((p) => p.type)).toEqual([
      "text",
      "items",
      "notice",
      "action",
      "action",
      "choice",
    ]);
  });

  it("omits an empty text part", () => {
    expect(buildParts({ text: "  " })).toEqual([]);
  });
});

describe("partsOf — sessions saved before parts existed still load", () => {
  it("derives parts from text and actions", () => {
    const parts = partsOf({ text: "Add it?", actions: [{}] });
    expect(parts).toEqual([
      { type: "text", text: "Add it?" },
      { type: "action", index: 0 },
    ]);
  });

  it("prefers the message's own parts", () => {
    const own = [{ type: "text" as const, text: "x" }];
    expect(partsOf({ text: "y", parts: own })).toBe(own);
  });
});

describe("cleaning what the server sends", () => {
  it("keeps string ids, drops junk, de-duplicates and caps rows", () => {
    const blocks = cleanItemsBlocks([
      { ids: ["a", "a", 3, "", "b"], heading: " This week " },
      { ids: [] },
      null,
      { ids: Array.from({ length: 40 }, (_, i) => `i${i}`) },
    ])!;
    expect(blocks[0]).toEqual({ ids: ["a", "b"], heading: "This week" });
    expect(blocks[1].ids).toHaveLength(25);
    expect(cleanItemsBlocks("nope")).toBeUndefined();
  });

  it("a choice needs at least two distinct options, at most four", () => {
    expect(cleanChoices(["Only one"])).toBeUndefined();
    expect(cleanChoices(["A", "A"])).toBeUndefined();
    expect(cleanChoices(["A", "B", "C", "D", "E"])).toEqual(["A", "B", "C", "D"]);
  });
});

describe("historyText", () => {
  it("gives the model the titles of rows the UI drew", () => {
    const text = historyText(
      { text: "Here is what is due.", parts: [{ type: "items", ids: ["a", "x", "b"] }] },
      (id) => ({ a: "Essay (Thu, Nov 12)", b: "Lab (Fri, Nov 13)" })[id],
    );
    expect(text).toBe("Here is what is due.\n- Essay (Thu, Nov 12)\n- Lab (Fri, Nov 13)");
  });

  it("leaves a plain message alone", () => {
    expect(historyText({ text: "Hi" }, () => "x")).toBe("Hi");
  });
});

describe("polishReply", () => {
  it("strips 'Based on your digest' openers", () => {
    expect(polishReply("Based on your digest, you have two things due.")).toBe(
      "You have two things due.",
    );
    expect(polishReply("Based on your data: nothing is due.")).toBe("Nothing is due.");
  });

  it("normalises * bullets to - and leaves bold alone", () => {
    expect(polishReply("Due:\n* **Essay** (Thu, Nov 12)\n* Lab (Fri, Nov 13)")).toBe(
      "Due:\n- **Essay** (Thu, Nov 12)\n- Lab (Fri, Nov 13)",
    );
  });

  it("turns a trailing italic note into a plain sentence", () => {
    expect(polishReply("You are free at 3.\n\n*[Note: the lab was moved.]*")).toBe(
      "You are free at 3.\n\nNote: the lab was moved.",
    );
    expect(polishReply("You are free.\n\n_That is all I can see._")).toBe(
      "You are free.\n\nThat is all I can see.",
    );
  });

  it("leaves ordinary text untouched", () => {
    const text = "You have 3 things due this week.";
    expect(polishReply(text)).toBe(text);
  });

  it("does not touch italics in the middle of a sentence", () => {
    expect(polishReply("It is *probably* fine.")).toBe("It is *probably* fine.");
  });
});
