import { describe, expect, it } from "vitest";
import { isBlockedHost, isBlockedIp, normalizeFeedInput } from "./ssrf";

describe("ssrf host checks", () => {
  it("blocks localhost and private hostnames", () => {
    expect(isBlockedHost("localhost")).toBe(true);
    expect(isBlockedHost("127.0.0.1")).toBe(true);
    expect(isBlockedHost("10.0.0.8")).toBe(true);
    expect(isBlockedHost("169.254.169.254")).toBe(true);
    expect(isBlockedHost("metadata.google.internal")).toBe(true);
    expect(isBlockedHost("calendar.google.com")).toBe(false);
  });

  it("blocks private IPs after DNS", () => {
    expect(isBlockedIp("192.168.1.1")).toBe(true);
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("8.8.8.8")).toBe(false);
  });

  it("normalizes webcal", () => {
    const url = normalizeFeedInput("webcal://example.com/cal.ics");
    expect(url?.protocol).toBe("https:");
  });
});
