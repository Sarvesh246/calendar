import { describe, expect, it } from "vitest";
import { parseBlocks } from "./markdown";

describe("parseBlocks", () => {
  it("reads paragraphs and a flat bullet list", () => {
    expect(parseBlocks("Due:\n- **Essay**\n- Lab")).toEqual([
      { kind: "p", lines: ["Due:"] },
      { kind: "list", ordered: false, items: [{ text: "**Essay**" }, { text: "Lab" }] },
    ]);
  });

  it("nests an indented list under the item above it", () => {
    const blocks = parseBlocks("- Essay\n  - outline\n  - draft\n- Lab");
    expect(blocks).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [
          { text: "Essay", sub: { ordered: false, items: ["outline", "draft"] } },
          { text: "Lab" },
        ],
      },
    ]);
  });

  it("nests a numbered sub-list too", () => {
    const [list] = parseBlocks("- Plan\n  1. read\n  2. write");
    expect(list).toMatchObject({
      items: [{ text: "Plan", sub: { ordered: true, items: ["read", "write"] } }],
    });
  });

  it("turns a pipe table into rows with a header, not into pipes", () => {
    const blocks = parseBlocks(
      "Here you go:\n\n| Item | Due |\n| --- | --- |\n| Essay | Thu, Nov 12 |\n| Lab | Fri, Nov 13 |",
    );
    expect(blocks[1]).toEqual({
      kind: "table",
      header: ["Item", "Due"],
      rows: [
        ["Essay", "Thu, Nov 12"],
        ["Lab", "Fri, Nov 13"],
      ],
    });
  });

  it("a lone pipe line is just text", () => {
    expect(parseBlocks("| not a table |")).toEqual([{ kind: "p", lines: ["| not a table |"] }]);
  });

  it("strips heading marks and keeps single line breaks", () => {
    expect(parseBlocks("## Plan\nline two")).toEqual([{ kind: "p", lines: ["Plan", "line two"] }]);
  });

  it("an ordered list stays ordered", () => {
    expect(parseBlocks("1. a\n2. b")).toEqual([
      { kind: "list", ordered: true, items: [{ text: "a" }, { text: "b" }] },
    ]);
  });
});
