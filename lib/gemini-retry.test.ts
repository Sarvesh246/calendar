import { describe, expect, it, vi } from "vitest";
import {
  classifyGeminiFailure,
  fetchGeminiJson,
  geminiBackoffMs,
  isGeminiTransientStatus,
  parseRetryAfterMs,
} from "./gemini-retry";

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function timeoutErr(): Error {
  const err = new Error("The operation was aborted due to timeout");
  err.name = "TimeoutError";
  return err;
}

describe("classifyGeminiFailure", () => {
  it("maps 429/503 to busy and everything else to unreachable", () => {
    expect(classifyGeminiFailure(429)).toBe("assistant-busy");
    expect(classifyGeminiFailure(503)).toBe("assistant-busy");
    expect(classifyGeminiFailure(0)).toBe("assistant-unreachable");
    expect(classifyGeminiFailure(500)).toBe("assistant-unreachable");
    expect(classifyGeminiFailure(504)).toBe("assistant-unreachable");
  });
});

describe("parseRetryAfterMs", () => {
  it("reads delta-seconds and HTTP dates, capped", () => {
    expect(parseRetryAfterMs("2")).toBe(2_000);
    expect(parseRetryAfterMs("120")).toBe(15_000);
    expect(parseRetryAfterMs(null)).toBeUndefined();
    const future = new Date(Date.now() + 3_000).toUTCString();
    const ms = parseRetryAfterMs(future);
    expect(ms).toBeGreaterThan(1_000);
    expect(ms).toBeLessThanOrEqual(15_000);
  });
});

describe("geminiBackoffMs", () => {
  it("grows exponentially and honors Retry-After", () => {
    expect(geminiBackoffMs(0, { random: () => 0 })).toBe(1_000);
    expect(geminiBackoffMs(1, { random: () => 0 })).toBe(2_000);
    expect(geminiBackoffMs(2, { random: () => 0 })).toBe(4_000);
    expect(geminiBackoffMs(0, { retryAfterMs: 5_000, random: () => 0 })).toBe(5_000);
  });
});

describe("fetchGeminiJson", () => {
  it("returns the first successful JSON body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const result = await fetchGeminiJson({
      url: "https://example.test",
      body: "{}",
      timeoutMs: 1_000,
      fetchImpl,
      sleep: async () => {},
    });
    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a single 503 and succeeds without surfacing busy", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "high demand" }, 503))
      .mockResolvedValueOnce(jsonResponse({ candidates: [] }));
    const slept: number[] = [];
    const result = await fetchGeminiJson({
      url: "https://example.test",
      body: "{}",
      timeoutMs: 1_000,
      attempts: 5,
      fetchImpl,
      sleep: async (ms) => {
        slept.push(ms);
      },
      random: () => 0,
    });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(slept[0]).toBe(1_000);
  });

  it("retries timeouts then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(timeoutErr())
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const result = await fetchGeminiJson({
      url: "https://example.test",
      body: "{}",
      timeoutMs: 1_000,
      attempts: 5,
      fetchImpl,
      sleep: async () => {},
      random: () => 0,
    });
    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("exhausts 429/503 retries as assistant-busy", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 503));
    const result = await fetchGeminiJson({
      url: "https://example.test",
      body: "{}",
      timeoutMs: 1_000,
      attempts: 5,
      fetchImpl,
      sleep: async () => {},
      random: () => 0,
    });
    expect(result).toEqual({ ok: false, lastStatus: 503, error: "assistant-busy" });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("exhausts timeouts as assistant-unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(timeoutErr());
    const result = await fetchGeminiJson({
      url: "https://example.test",
      body: "{}",
      timeoutMs: 1_000,
      attempts: 4,
      fetchImpl,
      sleep: async () => {},
      random: () => 0,
    });
    expect(result).toEqual({ ok: false, lastStatus: 0, error: "assistant-unreachable" });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("does not retry a non-transient 400", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "bad" }, 400));
    const result = await fetchGeminiJson({
      url: "https://example.test",
      body: "{}",
      timeoutMs: 1_000,
      attempts: 5,
      fetchImpl,
      sleep: async () => {},
    });
    expect(result.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(isGeminiTransientStatus(400)).toBe(false);
  });

  it("waits Retry-After on 429 before the next attempt", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429, { "Retry-After": "3" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const slept: number[] = [];
    await fetchGeminiJson({
      url: "https://example.test",
      body: "{}",
      timeoutMs: 1_000,
      fetchImpl,
      sleep: async (ms) => {
        slept.push(ms);
      },
      random: () => 0,
    });
    expect(slept[0]).toBe(3_000);
  });
});
