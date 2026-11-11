import { describe, expect, it } from "vitest";
import { normalizeActions, type AssistantReqBody } from "./assistant-actions";
import { fixWeekdays } from "./assistant-dates";
import { runAgent } from "./llm/agent";
import { systemPrompt } from "./llm/prompt";
import { LLM_PROVIDERS } from "./llm/providers";
import { DATEBOOK_TOOLS } from "./llm/tools";

/**
 * Live regression suite for the model path. Skipped unless a provider key is
 * set (GEMINI_API_KEY / GROQ_API_KEY / ...). It replays the exact server
 * prompt, tool schema and agent loop against a fixed synthetic calendar, runs
 * every prompt three times per provider and fails if the staged actions
 * disagree between runs. Run it against every provider in LLM_PROVIDERS before
 * changing the prompt or the routing order:
 *
 *   GEMINI_API_KEY=... npx vitest run lib/assistant-eval.test.ts
 */

// Tuesday, Nov 10 2026, 6:30pm in New York.
const NOW = "2026-11-10T23:30:00.000Z";
const TZ = "America/New_York";
const RUNS = 3;

const items: AssistantReqBody["items"] = [
  {
    id: "sg",
    title: "Study group meeting",
    type: "event",
    at: "2026-11-13T00:00:00.000Z",
    categoryId: "chem",
  }, // Thu 7pm
  {
    id: "adv",
    title: "Advisor meeting",
    type: "event",
    at: "2026-11-12T20:00:00.000Z",
    categoryId: "pols",
  }, // Thu 3pm
  {
    id: "lab",
    title: "Chem lab report 6",
    type: "assignment",
    status: "todo",
    at: "2026-11-14T04:59:00.000Z",
    categoryId: "chem",
  }, // Fri
  {
    id: "essay",
    title: "POLS essay",
    type: "assignment",
    status: "todo",
    at: "2026-11-14T04:59:00.000Z",
    categoryId: "pols",
  }, // Fri
  {
    id: "done",
    title: "Reading response",
    type: "assignment",
    status: "done",
    at: "2026-11-05T04:59:00.000Z",
    completedAt: "2026-11-04T20:00:00.000Z",
    categoryId: "pols",
  },
  { id: "gym", title: "Gym", type: "event", at: "2026-11-11T23:00:00.000Z" },
];

const body = (message: string): AssistantReqBody => ({
  message,
  now: NOW,
  timeZone: TZ,
  clock24h: false,
  weekStartsOn: 0,
  categories: [
    { id: "chem", name: "CHEM 101" },
    { id: "pols", name: "POLS 207" },
  ],
  items,
});

interface Case {
  prompt: string;
  /** What the staged actions must look like. */
  check: (actions: ReturnType<typeof normalizeActions>, text: string) => void;
  /** True when the right behaviour is to stage nothing. */
  noActions?: boolean;
}

const cases: Case[] = [
  {
    prompt: "am I free thursday at 7pm?",
    noActions: true,
    check: (_, text) => expect(text).not.toMatch(/^yes\b/i),
  },
  {
    prompt: "add dentist next tuesday 3pm at the clinic on main st",
    check: (actions) => {
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({ kind: "create", draft: { title: "Dentist" } });
      if (actions[0].kind === "create") {
        expect(actions[0].draft.location?.toLowerCase()).toContain("main st");
        expect(actions[0].draft.endAt).toBeUndefined();
      }
    },
  },
  {
    prompt: "add gym every monday and wednesday at 6am until nov 30",
    check: (actions) => {
      expect(actions).toHaveLength(1);
      if (actions[0].kind === "create") {
        expect(actions[0].draft.repeat?.freq).toBe("weekly");
        expect(actions[0].draft.repeat?.byDay).toEqual([1, 3]);
      }
    },
  },
  {
    prompt: "move the lab report to sunday",
    check: (actions) => {
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({ kind: "update", itemId: "lab" });
    },
  },
  {
    prompt: "delete the advisor meeting",
    check: (actions) => expect(actions).toMatchObject([{ kind: "delete", itemId: "adv" }]),
  },
  {
    prompt: "mark the lab report done",
    check: (actions) =>
      expect(actions).toMatchObject([{ kind: "update", itemId: "lab", patch: { status: "done" } }]),
  },
  {
    prompt: "add study group thursday 7pm",
    // The same thing is already there at that time: ask, do not stage a copy.
    noActions: true,
    check: () => {},
  },
  {
    prompt: "what did I finish last week?",
    noActions: true,
    check: (_, text) => expect(fixWeekdays(text, NOW, TZ)).toBe(text),
  },
];

const providers = LLM_PROVIDERS.filter(
  (p) => p.supportsTools && Boolean(process.env[p.keyEnv]?.trim()),
);

const key = (a: ReturnType<typeof normalizeActions>) =>
  JSON.stringify(
    a.map((x) =>
      x.kind === "create"
        ? { kind: x.kind, title: x.draft.title, at: x.draft.at, location: x.draft.location }
        : x.kind === "update"
          ? { kind: x.kind, id: x.itemId, patch: x.patch }
          : { kind: x.kind, id: x.itemId },
    ),
  );

describe.skipIf(providers.length === 0)("assistant eval (live model)", () => {
  for (const provider of providers) {
    describe(provider.id, () => {
      for (const c of cases) {
        it(c.prompt, { timeout: 120_000 }, async () => {
          const seen = new Set<string>();
          for (let run = 0; run < RUNS; run += 1) {
            const b = body(c.prompt);
            const result = await runAgent({
              provider,
              key: process.env[provider.keyEnv]!.trim(),
              messages: [
                { role: "system", content: systemPrompt(b) },
                { role: "user", content: c.prompt },
              ],
              userId: null,
              threadId: null,
              body: b,
              budget: { left: 4 },
            });
            const actions = normalizeActions(result.actions, b);
            if (c.noActions) expect(actions).toEqual([]);
            c.check(actions, result.text);
            seen.add(key(actions));
          }
          // Three runs, one answer.
          expect(seen.size).toBe(1);
        });
      }
    });
  }
});

describe("assistant eval harness", () => {
  it("has a tool list and prompt to replay", () => {
    expect(DATEBOOK_TOOLS.length).toBeGreaterThan(8);
    expect(systemPrompt(body("hi"))).toContain("Dates (copy the weekday");
  });
});
