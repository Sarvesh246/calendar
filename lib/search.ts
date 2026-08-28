import type { Category, Item } from "./types";

export function searchItems(
  items: Item[],
  categories: Category[],
  query: string
): Item[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const catName = (id: string) =>
    categories.find((c) => c.id === id)?.name.toLowerCase() ?? "";

  const scored = items
    .map((item) => {
      const hay = [
        item.title,
        item.description ?? "",
        item.location ?? "",
        catName(item.categoryId),
      ]
        .join(" ")
        .toLowerCase();
      if (!tokens.every((t) => hay.includes(t))) return null;
      const titleHit = item.title.toLowerCase().includes(q);
      return { item, score: titleHit ? 0 : 1 };
    })
    .filter((x): x is { item: Item; score: number } => x !== null)
    .sort((a, b) => a.score - b.score || a.item.title.localeCompare(b.item.title));

  return scored.map((s) => s.item);
}
