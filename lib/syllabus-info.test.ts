import { describe, expect, it } from "vitest";
import { rowToCategory, toCategoryRow } from "./db-sync";
import { normalizeSyllabusExtraction } from "./syllabus-extract";
import { applySyllabusImportToSnapshot } from "./syllabus-import";
import { normalizeSyllabusInfo, syllabusDigest } from "./syllabus-info";
import { econSyllabus } from "./local-assistant.fixture";

describe("normalizeSyllabusInfo", () => {
  it("keeps well-formed details and drops junk", () => {
    const info = normalizeSyllabusInfo({
      people: [{ role: "Professor", name: "Dr. Lee", email: "not-an-email" }, { role: "ta", name: "" }],
      grading: [{ component: "Final", weight: "40%" }, { component: "", weight: "10%" }],
      keyDates: [{ label: "Spring break", date: "2027-03-15", endDate: "2027-03-19" }, { label: "Bad", date: "March 3" }],
      website: "javascript:alert(1)",
      policies: [{ topic: "Late work", text: "x".repeat(2000) }],
    })!;
    expect(info.people).toEqual([{ role: "instructor", name: "Dr. Lee" }]);
    expect(info.grading).toHaveLength(1);
    expect(info.keyDates).toEqual([{ label: "Spring break", date: "2027-03-15", endDate: "2027-03-19" }]);
    expect(info.website).toBeUndefined();
    expect(info.policies[0].text.length).toBeLessThanOrEqual(700);
  });

  it("returns undefined when there is nothing worth keeping", () => {
    expect(normalizeSyllabusInfo({ courseName: "ECON 101" })).toBeUndefined();
    expect(normalizeSyllabusInfo(null)).toBeUndefined();
  });

  it("builds a compact digest for the model", () => {
    const text = syllabusDigest("Econ", econSyllabus);
    expect(text).toContain("Instructor: Dr. Maria Lopez; mlopez@uni.edu");
    expect(text).toContain("Late work:");
  });
});

describe("syllabus details through import and sync", () => {
  it("normalizes the model's info block alongside the items", () => {
    const out = normalizeSyllabusExtraction(
      { courseName: "Econ", courseCode: "ECON 101", items: [], info: { people: [{ role: "instructor", name: "Dr. Lopez" }] } },
      "2026-09-24T15:00:00.000Z",
      "America/Chicago"
    );
    expect(out.info?.people[0].name).toBe("Dr. Lopez");
    expect(out.info?.courseCode).toBe("ECON 101");
  });

  it("stores details on the class the import files into", () => {
    const { snapshot } = applySyllabusImportToSnapshot(
      { items: [], categories: [{ id: "c2", name: "Econ", color: "#34C759" }], importSources: [], deletions: {} },
      { drafts: [], timeZone: "UTC", forceCategoryId: "c2", fileName: "econ.pdf", info: econSyllabus },
      { now: "2026-09-24T15:00:00.000Z", id: () => "id1" }
    );
    const econ = snapshot.categories.find((c) => c.id === "c2")!;
    expect(econ.syllabus?.people[0].name).toBe("Dr. Maria Lopez");
    expect(econ.syllabus?.fileName).toBe("econ.pdf");
    expect(econ.updatedAt).toBe("2026-09-24T15:00:00.000Z");
  });

  it("round-trips through the categories row", () => {
    const row = toCategoryRow({ id: "c2", name: "Econ", color: "#34C759", syllabus: econSyllabus }, "u1");
    expect(row.syllabus).toBe(econSyllabus);
    expect(rowToCategory(row).syllabus?.grading).toEqual(econSyllabus.grading);
    // Every category row carries the column, so bulk upserts keep one key set.
    expect("syllabus" in toCategoryRow({ id: "c1", name: "CS", color: "#007AFF" }, "u1")).toBe(true);
  });
});
