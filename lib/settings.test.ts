import { describe, expect, it } from "vitest";
import { defaultUserSettings, normalizeSettings, sanitizeCategories } from "./settings";

describe("normalizeSettings", () => {
  it("keeps a valid local theme when the incoming row is missing or junk", () => {
    const local = { ...defaultUserSettings, preset: "ember" as const };
    expect(normalizeSettings(null, local).preset).toBe("ember");
    expect(normalizeSettings({ preset: "not-a-theme" as never }, local).preset).toBe("ember");
  });

  it("accepts a real preset from the incoming row", () => {
    const local = { ...defaultUserSettings, preset: "ember" as const };
    expect(normalizeSettings({ preset: "noir" }, local).preset).toBe("noir");
  });

  it("fills other fields from the fallback", () => {
    const local = { ...defaultUserSettings, preset: "ember" as const, density: "spacious" as const };
    const next = normalizeSettings({ preset: "ember" }, local);
    expect(next.density).toBe("spacious");
    expect(next.landingView).toBe("today");
  });
});

describe("sanitizeCategories", () => {
  it("drops holes and fills a missing name so import matching cannot crash", () => {
    const cats = sanitizeCategories([
      undefined,
      { id: "a", name: "Math 150", color: "#f00" },
      { id: "b", color: "#0f0" },
      { id: "c", name: "   ", color: "#00f" },
      null,
    ]);
    expect(cats.map((c) => c.name)).toEqual(["Math 150", "Untitled", "Untitled"]);
  });
});
