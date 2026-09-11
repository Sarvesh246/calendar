/** Place overlapping timed events into columns so they sit side-by-side. */
export function assignOverlapColumns<T extends { startMin: number; endMin: number }>(
  items: T[]
): (T & { col: number; colCount: number })[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  let colEnd: number[] = [];
  let group: (T & { col: number })[] = [];
  const placed: (T & { col: number; colCount: number })[] = [];
  let groupEnd = -Infinity;
  const flush = () => {
    for (const item of group) placed.push({ ...item, colCount: colEnd.length });
    group = [];
    colEnd = [];
  };

  for (const item of sorted) {
    if (item.startMin >= groupEnd) flush();
    let col = colEnd.findIndex((end) => end <= item.startMin);
    if (col === -1) {
      col = colEnd.length;
      colEnd.push(item.endMin);
    } else {
      colEnd[col] = item.endMin;
    }
    group.push({ ...item, col });
    groupEnd = Math.max(groupEnd, item.endMin);
  }

  flush();
  return placed;
}
