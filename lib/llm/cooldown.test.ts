import { beforeEach, describe, expect, it, vi } from "vitest";
import { LLM_PROVIDERS } from "./providers";

vi.mock("server-only", () => ({}));

const durable = new Map<string, number>();
const persisted: Array<[string, number]> = [];
vi.mock("./cooldown-store", async (original) => {
  const real = await original<typeof import("./cooldown-store")>();
  return {
    ...real,
    loadDurableCooldowns: async () => new Map(durable),
    persistDurableCooldown: async (id: string, until: number) => {
      persisted.push([id, until]);
    },
  };
});

const { providerCandidates, putProviderOnCooldown } = await import("./router");
const { ProviderRequestError } = await import("./openai-compatible");

const tools = LLM_PROVIDERS.filter((p) => p.supportsTools);

beforeEach(() => {
  durable.clear();
  persisted.length = 0;
  for (const p of tools) process.env[p.keyEnv] = "test-key";
});

describe("provider cooldowns are durable", () => {
  it("a cooldown another instance recorded keeps a provider out of rotation", async () => {
    const victim = tools[0];
    durable.set(victim.id, Date.now() + 10 * 60_000);
    const { providers } = await providerCandidates("auto");
    expect(providers.map((p) => p.id)).not.toContain(victim.id);
  });

  it("a 429 here is written to the durable store", () => {
    putProviderOnCooldown(tools[0], new ProviderRequestError("rate limited", 429, 60_000));
    expect(persisted).toHaveLength(1);
    expect(persisted[0][0]).toBe(tools[0].id);
    expect(persisted[0][1]).toBeGreaterThan(Date.now());
  });
});

it("does not route mutations to smaller fallback models", async () => {
  const { providers } = await providerCandidates("gemini-3.5-flash-lite", true);
  expect(providers.every((provider) => /120b/i.test(provider.model))).toBe(true);
});
