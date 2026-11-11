import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  rate: vi.fn(),
  durable: vi.fn(),
  origin: vi.fn(),
}));
vi.mock("@/lib/api-guard", () => ({
  clientKey: () => "key",
  rateLimit: mocks.rate,
  durableHourlyLimit: mocks.durable,
  sameOrigin: mocks.origin,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: () => ({ insert: mocks.insert }) }),
}));
import { POST } from "@/app/api/diagnostics/route";
const event = {
  type: "event_timing",
  at: 123,
  route: "today",
  kind: "click",
  duration: 40,
  delay: 10,
};
const payload = {
  device: "f6e21aaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  session: "f6e21aaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
  events: [event],
};
function request(value: unknown) {
  return new Request("https://example.com/api/diagnostics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.origin.mockReturnValue(true);
  mocks.rate.mockReturnValue(true);
  mocks.durable.mockResolvedValue(true);
  mocks.insert.mockResolvedValue({ error: null });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
});
describe("diagnostic collection", () => {
  it("stores bounded, validated timing metrics", async () => {
    expect((await POST(request(payload))).status).toBe(204);
    expect(mocks.insert).toHaveBeenCalledWith({
      device_id: payload.device,
      session_id: payload.session,
      events: payload.events,
    });
  });
  it("rejects unexpected fields such as user text", async () => {
    expect(
      (await POST(request({ ...payload, events: [{ ...event, text: "private" }] }))).status,
    ).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("rejects excessive batches and cross-origin requests", async () => {
    expect((await POST(request({ ...payload, events: Array(41).fill(event) }))).status).toBe(400);
    mocks.origin.mockReturnValue(false);
    expect((await POST(request(payload))).status).toBe(403);
  });
  it("rejects oversized request bodies without a content-length header", async () => {
    const oversized = new Request("https://example.com/api/diagnostics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "x".repeat(17000),
    });
    expect((await POST(oversized)).status).toBe(413);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("fails closed when the durable quota fails", async () => {
    mocks.durable.mockResolvedValue(false);
    expect((await POST(request(payload))).status).toBe(429);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
