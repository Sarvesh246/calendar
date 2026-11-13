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

it("routes mutations to the larger models first and keeps smaller ones as a fallback", async () => {
  const { providers } = await providerCandidates("gemini-3.5-flash-lite", true);
  const large = providers.map((provider) => /120b/i.test(provider.model));
  expect(large[0]).toBe(true);
  expect(large.lastIndexOf(true)).toBeLessThan(large.indexOf(false));
  expect(providers.map((provider) => provider.id)).toContain("gemini-3.5-flash-lite");
});

it("still offers smaller models for a mutation when every larger model is cooling down", async () => {
  // Set in this instance directly: the durable store is only re-read every few seconds.
  for (const p of tools.filter((p) => /120b/i.test(p.model)))
    putProviderOnCooldown(p, new ProviderRequestError("rate limited", 429, 60_000));
  const { providers } = await providerCandidates("auto", true);
  expect(providers.length).toBeGreaterThan(0);
  expect(providers.some((provider) => /120b/i.test(provider.model))).toBe(false);
});
