import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tryLocalAnswer, resetLocalAssistantState } from "./local-assistant";
import { normalizeActions, type AssistantReqBody } from "./assistant-actions";
import { runAgent } from "./llm/agent";
import { systemPrompt } from "./llm/prompt";
import { LLM_PROVIDERS } from "./llm/providers";

const NOW = new Date(2026, 10, 10, 10);
const titles = [
  "Hackathon",
  "Conference",
  "Retreat",
  "Festival",
  "Workshop",
  "Trip",
  "Offsite",
  "Tournament",
  "Seminar",
  "Convention",
];
const phrasings = [
  (t: string) => `add ${t} nov 14-16 at Zachry`,
  (t: string) => `add ${t} november 14-16 at Zachry`,
  (t: string) => `add ${t} november 14 to november 16 at Zachry`,
  (t: string) => `add ${t} from november 14 to november 16 at Zachry`,
  (t: string) => `schedule ${t} november 14 through november 16 at Zachry`,
  (t: string) => `put ${t} on my calendar nov 14-16, location Zachry`,
  (t: string) => `add event: ${t}, november 14-16, location Zachry`,
  (t: string) => `create ${t} from nov 14 through nov 16 in Zachry`,
  (t: string) => `add ${t} nov 14 to nov 16 location Zachry`,
  (t: string) => `schedule ${t} from november 14 to november 16 at the Zachry`,
  (t: string) => `add ${t} november 14-16 in Zachry`,
  (t: string) => `book ${t} nov 14-16 at Zachry`,
  (t: string) => `add ${t} november 14 through 16 at Zachry`,
  (t: string) => `create ${t} november 14 to 16 at Zachry`,
  (t: string) => `put ${t} on my calendar from nov 14 to nov 16 at Zachry`,
];
const cases = titles.flatMap((title) =>
  phrasings.map((phrase) => ({ title, message: phrase(title) })),
);
const ctx = { items: [], categories: [], clock24h: false };
const body = (message: string): AssistantReqBody => ({
  message,
  now: "2026-11-10T16:00:00.000Z",
  timeZone: "America/Chicago",
  items: [],
  itemCount: 0,
  categories: [],
});

function assertCreate(
  action: ReturnType<typeof normalizeActions>[number] | undefined,
  title: string,
  timeZone = "America/Chicago",
) {
  expect(action?.kind).toBe("create");
  if (!action || action.kind !== "create") return;
  expect(action.draft.title.toLowerCase()).toBe(title.toLowerCase());
  expect(action.draft.type).toBe("event");
  expect(action.draft.allDay).toBe(true);
  expect(action.draft.location?.toLowerCase()).toContain("zachry");
  const day = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  expect(day(action.draft.at)).toBe("2026-11-14");
  expect(action.draft.endAt && day(action.draft.endAt)).toBe("2026-11-17");
}

describe("150 local interpretation cases", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    resetLocalAssistantState();
  });
  afterEach(() => vi.useRealTimers());
  it.each(cases)("does not misinterpret $message", ({ message, title }) => {
    const result = tryLocalAnswer(message, [], ctx, NOW);
    const actions = result?.actions ?? [];
    if (!actions.length) return; // A conservative handoff is safe.
    expect(actions).toHaveLength(1);
    assertCreate(actions[0], title, Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});

// Explicit opt-in: this sends 150 real requests to every configured provider.
// Run: set DATEBOOK_GOLDEN_LIVE=1 and the provider keys, then vitest run this file.
const providers =
  process.env.DATEBOOK_GOLDEN_LIVE === "1"
    ? LLM_PROVIDERS.filter((p) => p.supportsTools && process.env[p.keyEnv]?.trim())
    : [];
describe.skipIf(!providers.length)("live provider golden set", () => {
  for (const provider of providers) {
    describe(provider.id, () => {
      it.each(cases)("interprets $message", { timeout: 120_000 }, async ({ message, title }) => {
        const b = body(message);
        const result = await runAgent({
          provider,
          key: process.env[provider.keyEnv]!,
          messages: [
            { role: "system", content: systemPrompt(b) },
            { role: "user", content: message },
          ],
          userId: null,
          threadId: null,
          body: b,
          budget: { left: 6 },
        });
        const actions = normalizeActions(result.actions, b);
        expect(actions).toHaveLength(1);
        assertCreate(actions[0], title);
      });
    });
  }
});

// Diverse fixed requests exercise real model output. A handoff is never a pass:
// every case requires exactly one complete confirmation card.
const diverseCases = [
  [
    "add TAMUhack from november 14 to november 16 at the MSC",
    "TAMUhack",
    "2026-11-14",
    "2026-11-17",
    "MSC",
  ],
  [
    "Add event: Aggie Ring Day, April 10-11, Clayton Williams Alumni Center",
    "Aggie Ring Day",
    "2027-04-10",
    "2027-04-12",
    "Clayton Williams Alumni Center",
  ],
  [
    "put Parents weekend on my calendar oct 9-11, location Kyle Field",
    "Parents weekend",
    "2027-10-09",
    "2027-10-12",
    "Kyle Field",
  ],
  [
    "add spring break trip march 9 through march 15 in Austin",
    "Spring break trip",
    "2027-03-09",
    "2027-03-16",
    "Austin",
  ],
  ["add hackathon this weekend at zachry", "Hackathon", "2026-11-14", "2026-11-16", "zachry"],
  ["add hackathon 11/14-11/16 zachry", "Hackathon", "2026-11-14", "2026-11-17", "zachry"],
  ["add retreat december 5-6 at the library", "Retreat", "2026-12-05", "2026-12-07", "library"],
  ["add festival december 12-13 in Austin", "Festival", "2026-12-12", "2026-12-14", "Austin"],
  ["schedule conference january 8-10 at the MSC", "Conference", "2027-01-08", "2027-01-11", "MSC"],
  ["add workshop january 16-17 at Zachry", "Workshop", "2027-01-16", "2027-01-18", "Zachry"],
  [
    "add tournament february 6-7 at Kyle Field",
    "Tournament",
    "2027-02-06",
    "2027-02-08",
    "Kyle Field",
  ],
  ["add reunion february 13-14 in Dallas", "Reunion", "2027-02-13", "2027-02-15", "Dallas"],
  [
    "schedule convention march 5-7 at the Hilton",
    "Convention",
    "2027-03-05",
    "2027-03-08",
    "Hilton",
  ],
  ["add camping trip march 20-21 in Austin", "Camping trip", "2027-03-20", "2027-03-22", "Austin"],
  ["add career fair april 2-3 at the MSC", "Career fair", "2027-04-02", "2027-04-04", "MSC"],
  ["add science fair april 17-18 at Zachry", "Science fair", "2027-04-17", "2027-04-19", "Zachry"],
  ["add family visit may 1-2 in Houston", "Family visit", "2027-05-01", "2027-05-03", "Houston"],
  [
    "schedule graduation may 14-15 at Reed Arena",
    "Graduation",
    "2027-05-14",
    "2027-05-16",
    "Reed Arena",
  ],
  ["add orientation june 5-6 at the MSC", "Orientation", "2027-06-05", "2027-06-07", "MSC"],
  ["add summer camp july 10-12 in Austin", "Summer camp", "2027-07-10", "2027-07-13", "Austin"],
  ["add competition august 7-8 at Zachry", "Competition", "2027-08-07", "2027-08-09", "Zachry"],
  [
    "add volunteer weekend september 11-12 at the library",
    "Volunteer weekend",
    "2027-09-11",
    "2027-09-13",
    "library",
  ],
  [
    "add homecoming october 16-17 at Kyle Field",
    "Homecoming",
    "2027-10-16",
    "2027-10-18",
    "Kyle Field",
  ],
] as const;

describe.skipIf(!providers.length)("diverse live creation golden set", () => {
  for (const provider of providers) {
    it.each(diverseCases)(
      "interprets %s",
      { timeout: 120_000 },
      async (message, title, start, end, location) => {
        const b = body(message);
        const result = await runAgent({
          provider,
          key: process.env[provider.keyEnv]!,
          messages: [
            { role: "system", content: systemPrompt(b) },
            { role: "user", content: message },
          ],
          userId: null,
          threadId: null,
          body: b,
          budget: { left: 6 },
        });
        const actions = normalizeActions(result.actions, b);
        expect(actions).toHaveLength(1);
        const action = actions[0];
        expect(action.kind).toBe("create");
        if (action.kind !== "create") return;
        const day = (value: string) =>
          new Intl.DateTimeFormat("en-CA", {
            timeZone: b.timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date(value));
        expect(action.draft.title.toLowerCase()).toBe(title.toLowerCase());
        expect(day(action.draft.at)).toBe(start);
        expect(action.draft.endAt && day(action.draft.endAt)).toBe(end);
        expect(action.draft.location?.toLowerCase().replace(/^the /, "")).toBe(
          location.toLowerCase(),
        );
        expect(action.draft.categoryId).toBe("");
      },
    );
  }
});

describe.skipIf(!providers.length)("live reported failures", () => {
  for (const provider of providers) {
    it.each([
      {
        message: "add homework 3 in CSCE 221 due friday",
        title: "Homework 3",
        day: "2026-11-13",
        location: "",
        categoryId: "cs",
      },
      {
        message: "schedule a check in with my advisor next tuesday at 3pm",
        title: "Check in with my advisor",
        day: "2026-11-17",
        location: "",
        categoryId: "",
      },
      {
        message: "add exam on the 14th at 2 in HELD 105",
        title: "Exam",
        day: "2026-11-14",
        location: "HELD 105",
        categoryId: "",
      },
    ])(
      "preserves $message",
      { timeout: 120_000 },
      async ({ message, title, day, location, categoryId }) => {
        const b = {
          ...body(message),
          categories: [
            { id: "cs", name: "CSCE 221" },
            { id: "chem", name: "CHEM 107" },
          ],
        };
        const result = await runAgent({
          provider,
          key: process.env[provider.keyEnv]!,
          messages: [
            { role: "system", content: systemPrompt(b) },
            { role: "user", content: message },
          ],
          userId: null,
          threadId: null,
          body: b,
          budget: { left: 6 },
        });
        const actions = normalizeActions(result.actions, b);
        expect(actions).toHaveLength(1);
        const action = actions[0];
        expect(action.kind).toBe("create");
        if (action.kind !== "create") return;
        expect(action.draft.title.toLowerCase()).toBe(title.toLowerCase());
        expect(
          new Intl.DateTimeFormat("en-CA", {
            timeZone: b.timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date(action.draft.at)),
        ).toBe(day);
        expect((action.draft.location ?? "").toLowerCase()).toBe(location.toLowerCase());
        expect(action.draft.categoryId).toBe(categoryId);
      },
    );
  }
});
