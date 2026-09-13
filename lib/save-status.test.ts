import { describe, expect, it } from "vitest";
import { describeSaveStatus } from "./save-status";

const cloud = { mode: "cloud" as const, online: true, queued: 0, syncStatus: "synced" as const };

describe("describeSaveStatus", () => {
  it("reassures a signed-out user that the device has it", () => {
    const v = describeSaveStatus({ ...cloud, mode: "local" });
    expect(v.title).toBe("Saved on this device");
    expect(v.transient).toBe(true);
    expect(v.retry).toBe(false);
  });

  it("says saved once the cloud has acknowledged", () => {
    const v = describeSaveStatus(cloud);
    expect(v.tone).toBe("saved");
    expect(v.title).toBe("Saved");
    expect(v.transient).toBe(true);
  });

  it("stays on screen while writes are queued", () => {
    const v = describeSaveStatus({ ...cloud, queued: 3 });
    expect(v.title).toBe("Waiting to sync");
    expect(v.detail).toBe("Saved here. 3 changes still to upload.");
    expect(v.transient).toBe(false);
  });

  it("leads with connectivity, not with a sync that has not been tried", () => {
    // Offline with a clean "synced" status is exactly the case that used to
    // claim everything was fine.
    const v = describeSaveStatus({ ...cloud, online: false, queued: 1 });
    expect(v.tone).toBe("pending");
    expect(v.title).toBe("Waiting to sync");
    expect(v.detail).toContain("back online");
    expect(v.transient).toBe(false);
  });

  it("uses singular wording for one queued change", () => {
    const v = describeSaveStatus({ ...cloud, online: false, queued: 1 });
    expect(v.detail).toBe("Saved here. 1 change will upload when you're back online.");
  });

  it("offers a retry on failure and keeps the card up", () => {
    const v = describeSaveStatus({
      ...cloud,
      syncStatus: "error",
      error: "network request failed",
    });
    expect(v.tone).toBe("error");
    expect(v.retry).toBe(true);
    expect(v.transient).toBe(false);
    expect(v.detail).toBe("network request failed");
  });

  it("falls back to a plain reassurance when the error has no message", () => {
    const v = describeSaveStatus({ ...cloud, syncStatus: "error", error: "  " });
    expect(v.detail).toBe("Your changes are saved on this device.");
  });

  it("shows progress while a batch is in flight", () => {
    const v = describeSaveStatus({ ...cloud, syncStatus: "syncing", queued: 2 });
    expect(v.title).toBe("Saving…");
    expect(v.transient).toBe(true);
  });
});
