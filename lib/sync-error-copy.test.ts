import { describe, expect, it } from "vitest";
import { friendlySyncError } from "./sync-error-copy";

describe("friendlySyncError", () => {
  it("never shows the raw server message as the explanation", () => {
    for (const raw of [
      "TypeError: Failed to fetch",
      "JWT expired — PGRST301",
      "permission denied for table items — 42501",
      "Could not find the 'class_title' column — PGRST204",
      "simulated outage — XX000",
      null,
    ]) {
      const copy = friendlySyncError(raw);
      expect(copy).not.toMatch(/PGRST|XX000|42501|JWT/);
      expect(copy.length).toBeGreaterThan(20);
    }
  });

  it("names the cause when it is recognisable", () => {
    expect(friendlySyncError("TypeError: Failed to fetch")).toMatch(/reach the server/);
    expect(friendlySyncError("JWT expired")).toMatch(/sign-in has expired/);
    expect(friendlySyncError("permission denied for table items")).toMatch(/couldn't save/);
  });
});
