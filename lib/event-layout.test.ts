import { describe, expect, it } from "vitest";
import { assignOverlapColumns } from "./event-layout";

describe("overlap columns", () => {
  it("keeps one width across a connected overlap group", () => {
    const blocks = assignOverlapColumns([
      { startMin: 0, endMin: 30 },
      { startMin: 0, endMin: 90 },
      { startMin: 20, endMin: 60 },
      { startMin: 60, endMin: 120 },
    ]);
    for (const a of blocks) for (const b of blocks) {
      if (a === b || a.startMin >= b.endMin || b.startMin >= a.endMin) continue;
      const left = Math.max(a.col / a.colCount, b.col / b.colCount);
      const right = Math.min((a.col + 1) / a.colCount, (b.col + 1) / b.colCount);
      expect(right).toBeLessThanOrEqual(left);
    }
  });

  it("restores full width after an overlap group ends", () => {
    const blocks = assignOverlapColumns([
      { startMin: 0, endMin: 60 }, { startMin: 0, endMin: 60 },
      { startMin: 60, endMin: 90 },
    ]);
    expect(blocks[2]).toMatchObject({ col: 0, colCount: 1 });
  });
});
