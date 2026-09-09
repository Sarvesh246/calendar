import { describe, expect, it } from "vitest";
import { wallTimeInZoneToIso } from "./date-utils";
import {
  extractedItemToDraft,
  inferSyllabusDueDate,
  isPdfMagic,
  isSyllabusDueDateInWindow,
  isSyllabusExtractError,
  isSyllabusRetryableError,
  looksLikeSyllabusPdf,
  MAX_SYLLABUS_PDF_BYTES,
  normalizeDueTime,
  normalizeSyllabusExtraction,
  parseCategoryHints,
  retrySyllabusExtractOnce,
  SyllabusExtractRequestError,
  syllabusErrorFromResponse,
  syllabusExtractErrorMessage,
} from "./syllabus-extract";

const TZ = "America/Chicago";
/** Wednesday 9 Sep 2026, 12:00 CDT. */
const SEP = new Date("2026-09-09T17:00:00.000Z");
/** Monday 1 Feb 2027, 12:00 CST. */
const FEB = new Date("2027-02-01T18:00:00.000Z");
/** Friday 31 Jul 2026, 12:00 CDT. */
const JUL = new Date("2026-07-31T17:00:00.000Z");

describe("isPdfMagic", () => {
  it("accepts %PDF and rejects other bytes", () => {
    expect(isPdfMagic(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))).toBe(true);
    expect(isPdfMagic(new Uint8Array([0x25, 0x50, 0x44]))).toBe(false);
    expect(isPdfMagic(new TextEncoder().encode("not a pdf"))).toBe(false);
  });
});

describe("inferSyllabusDueDate", () => {
  it("keeps a full ISO date in the window", () => {
    expect(inferSyllabusDueDate("2026-10-15", SEP, TZ)).toBe("2026-10-15");
  });

  it("maps spring dates in the fall to the next calendar year", () => {
    expect(inferSyllabusDueDate("01-20", SEP, TZ)).toBe("2027-01-20");
    expect(inferSyllabusDueDate("5/1", SEP, TZ)).toBe("2027-05-01");
  });

  it("maps fall dates in the spring to last fall", () => {
    expect(inferSyllabusDueDate("09-15", FEB, TZ)).toBe("2026-09-15");
  });

  it("in July, fall dates belong to the upcoming term", () => {
    expect(inferSyllabusDueDate("09-15", JUL, TZ)).toBe("2026-09-15");
  });

  it("drops dates more than ~18 months past or ~2 years ahead", () => {
    expect(inferSyllabusDueDate("2024-01-01", SEP, TZ)).toBeUndefined();
    expect(inferSyllabusDueDate("2029-09-09", SEP, TZ)).toBeUndefined();
    expect(isSyllabusDueDateInWindow("2025-03-09", SEP, TZ)).toBe(true);
    expect(isSyllabusDueDateInWindow("2028-09-09", SEP, TZ)).toBe(true);
  });

  it("rejects impossible calendar days", () => {
    expect(inferSyllabusDueDate("2026-02-30", SEP, TZ)).toBeUndefined();
  });
});

describe("normalizeDueTime", () => {
  it("normalizes 12-hour and 24-hour clock times", () => {
    expect(normalizeDueTime("23:59")).toBe("23:59");
    expect(normalizeDueTime("9:05")).toBe("09:05");
    expect(normalizeDueTime("11:59 PM")).toBe("23:59");
    expect(normalizeDueTime("12:00 am")).toBe("00:00");
    expect(normalizeDueTime("noon")).toBeUndefined();
  });
});

describe("normalizeSyllabusExtraction", () => {
  it("keeps graded rows and drops undated or out-of-window ones", () => {
    const out = normalizeSyllabusExtraction(
      {
        courseName: "  Intro to Compilers  ",
        courseCode: "CS 4240",
        items: [
          { title: "HW 1", dueDate: "2026-09-16", type: "assignment", kind: "hw" },
          { title: "Midterm", dueDate: "2026-10-20", dueTime: "10:00 AM", type: "event", kind: "exam" },
          { title: "Skipped", dueDate: "2020-01-01", kind: "homework" },
          { title: "", dueDate: "2026-09-20" },
          { title: "Office hours", dueDate: "not-a-date" },
        ],
      },
      SEP.toISOString(),
      TZ
    );
    expect(out.courseName).toBe("Intro to Compilers");
    expect(out.courseCode).toBe("CS 4240");
    expect(out.items).toEqual([
      { title: "HW 1", dueDate: "2026-09-16", type: "assignment", kind: "homework" },
      {
        title: "Midterm",
        dueDate: "2026-10-20",
        dueTime: "10:00",
        type: "event",
        kind: "exam",
      },
    ]);
  });

  it("keeps an explicit exam end time and drops empty extracts", () => {
    const withEnd = normalizeSyllabusExtraction(
      {
        items: [
          {
            title: "Midterm",
            dueDate: "2026-10-20",
            dueTime: "10:00",
            endTime: "11:30",
            type: "event",
            kind: "exam",
          },
        ],
      },
      SEP.toISOString(),
      TZ
    );
    expect(withEnd.items[0].endTime).toBe("11:30");
    const empty = normalizeSyllabusExtraction({ items: [] }, SEP.toISOString(), TZ);
    expect(empty.items).toEqual([]);
    expect(empty.courseName).toBe("");
  });

  it("defaults type to assignment and kind to other", () => {
    const out = normalizeSyllabusExtraction(
      { items: [{ title: "Thing", dueDate: "2026-09-20" }] },
      SEP.toISOString(),
      TZ
    );
    expect(out.items[0]).toMatchObject({ type: "assignment", kind: "other" });
  });
});

describe("parseCategoryHints", () => {
  it("accepts a JSON name list or {id,name} objects", () => {
    expect(parseCategoryHints('["ENGL 101","MATH 220"]')).toEqual([
      { id: "", name: "ENGL 101" },
      { id: "", name: "MATH 220" },
    ]);
    expect(parseCategoryHints([{ id: "c1", name: "Bio" }])).toEqual([{ id: "c1", name: "Bio" }]);
    expect(parseCategoryHints("nope")).toEqual([]);
  });
});

describe("extractedItemToDraft", () => {
  it("sets endAt only when the syllabus gave an end after the start", () => {
    const timed = extractedItemToDraft(
      {
        title: "Midterm",
        dueDate: "2026-10-20",
        dueTime: "10:00",
        endTime: "11:30",
        type: "event",
        kind: "exam",
      },
      TZ
    );
    expect(timed.endAt).toBe(wallTimeInZoneToIso("2026-10-20", 11, 30, TZ));
    expect(timed.at).toBe(wallTimeInZoneToIso("2026-10-20", 10, 0, TZ));

    const startOnly = extractedItemToDraft(
      {
        title: "Midterm",
        dueDate: "2026-10-20",
        dueTime: "10:00",
        type: "event",
        kind: "exam",
      },
      TZ
    );
    expect(startOnly.endAt).toBeUndefined();
  });

  it("does not invent an end for a date-only assignment", () => {
    const draft = extractedItemToDraft(
      { title: "HW 1", dueDate: "2026-09-16", type: "assignment", kind: "homework" },
      TZ
    );
    expect(draft.endAt).toBeUndefined();
    expect(draft.at).toBe(wallTimeInZoneToIso("2026-09-16", 23, 59, TZ));
  });
});

describe("syllabus extract error paths", () => {
  it("maps not-configured, too-large, and invalid PDF to user messages", () => {
    expect(syllabusExtractErrorMessage("assistant-not-configured", 200)).toMatch(/isn't set up/i);
    expect(syllabusExtractErrorMessage("payload-too-large", 413)).toMatch(
      new RegExp(`max ${(MAX_SYLLABUS_PDF_BYTES / (1024 * 1024)).toFixed(1)} MB`)
    );
    expect(syllabusExtractErrorMessage("invalid-pdf", 400)).toMatch(/doesn't look like a PDF/i);
    expect(syllabusExtractErrorMessage("missing-pdf", 400)).toMatch(/choose a pdf/i);
    expect(isSyllabusExtractError("assistant-not-configured")).toBe(true);
    expect(isSyllabusExtractError("nope")).toBe(false);
  });

  it("distinguishes busy, unreachable, and rate-limited copy", () => {
    expect(syllabusExtractErrorMessage("assistant-busy", 200)).toMatch(/reader is busy/i);
    expect(syllabusExtractErrorMessage("assistant-unreachable", 200)).toMatch(/couldn't reach/i);
    expect(syllabusExtractErrorMessage("rate-limited", 429)).toMatch(/too many syllabus reads/i);
    expect(syllabusErrorFromResponse("assistant-busy", 200)).toBe("assistant-busy");
    expect(syllabusErrorFromResponse(undefined, 503)).toBe("assistant-busy");
    expect(syllabusErrorFromResponse(undefined, 504)).toBe("assistant-unreachable");
    expect(syllabusErrorFromResponse(undefined, 429)).toBe("rate-limited");
    expect(syllabusErrorFromResponse("invalid-pdf", 400)).toBe("invalid-pdf");
    expect(isSyllabusRetryableError("assistant-busy")).toBe(true);
    expect(isSyllabusRetryableError("assistant-unreachable")).toBe(true);
    expect(isSyllabusRetryableError("invalid-pdf")).toBe(false);
    expect(isSyllabusRetryableError("rate-limited")).toBe(false);
  });

  it("retries busy/unreachable once and does not retry invalid PDFs", async () => {
    const signal = new AbortController().signal;
    let busyCalls = 0;
    const ok = await retrySyllabusExtractOnce(
      async () => {
        busyCalls += 1;
        if (busyCalls === 1) throw new SyllabusExtractRequestError("assistant-busy", 200);
        return "ok";
      },
      { signal, delayMs: 10, wait: async () => {} }
    );
    expect(ok).toBe("ok");
    expect(busyCalls).toBe(2);

    let pdfCalls = 0;
    await expect(
      retrySyllabusExtractOnce(
        async () => {
          pdfCalls += 1;
          throw new SyllabusExtractRequestError("invalid-pdf", 400);
        },
        { signal, delayMs: 10, wait: async () => {} }
      )
    ).rejects.toMatchObject({ code: "invalid-pdf" });
    expect(pdfCalls).toBe(1);
  });

  it("accepts PDF types and names, rejects other files", () => {
    expect(looksLikeSyllabusPdf({ type: "application/pdf", name: "x.bin" })).toBe(true);
    expect(looksLikeSyllabusPdf({ type: "", name: "syllabus.pdf" })).toBe(true);
    expect(looksLikeSyllabusPdf({ type: "application/octet-stream", name: "s.pdf" })).toBe(true);
    expect(looksLikeSyllabusPdf({ type: "image/png", name: "scan.png" })).toBe(false);
    expect(looksLikeSyllabusPdf({ type: "text/plain", name: "notes.txt" })).toBe(false);
  });
});
