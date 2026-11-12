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
