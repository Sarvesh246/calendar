/** Place overlapping timed events into columns so they sit side-by-side. */
export function assignOverlapColumns<T extends { startMin: number; endMin: number }>(
  items: T[]
): (T & { col: number; colCount: number })[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const colEnd: number[] = [];
  const placed: (T & { col: number })[] = [];

  for (const item of sorted) {
    let col = colEnd.findIndex((end) => end <= item.startMin);
    if (col === -1) {
      col = colEnd.length;
      colEnd.push(item.endMin);
    } else {
      colEnd[col] = item.endMin;
    }
    placed.push({ ...item, col });
  }

  return placed.map((item, i) => {
    let colCount = item.col + 1;
    for (let j = 0; j < placed.length; j++) {
      if (j === i) continue;
      const other = placed[j];
      if (item.startMin < other.endMin && other.startMin < item.endMin) {
        colCount = Math.max(colCount, other.col + 1);
      }
    }
    return { ...item, colCount: Math.max(colCount, 1) };
  });
}
