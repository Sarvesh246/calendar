import { describe, expect, it } from "vitest";
import { parsePushEndpoint, validPushKey } from "./push-endpoint";

describe("push endpoint validation", () => {
  it("accepts a normal HTTPS push URL", () => {
    expect(parsePushEndpoint("https://fcm.googleapis.com/fcm/send/example")?.hostname).toBe(
      "fcm.googleapis.com"
    );
  });

  it.each([
    "http://push.example/sub",
    "https://localhost/sub",
    "https://127.0.0.1/sub",
    "https://user:pass@push.example/sub",
    "https://push.example:8443/sub",
    "https://attacker.example/sub",
  ])("rejects unsafe endpoint %s", (endpoint) => {
    expect(parsePushEndpoint(endpoint)).toBeNull();
  });

  it("bounds and validates subscription keys", () => {
    expect(validPushKey("abc_DEF-123", 8, 32)).toBe(true);
    expect(validPushKey("not base64!", 8, 32)).toBe(false);
  });
});
