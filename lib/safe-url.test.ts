import { describe, expect, it } from "vitest";
import { safeExternalUrl } from "./safe-url";

describe("safeExternalUrl", () => {
  it("keeps ordinary web links", () => {
    expect(safeExternalUrl("https://canvas.example/assignment/1")).toBe(
      "https://canvas.example/assignment/1"
    );
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "https://user:password@example.com/private",
    "https://example.com/line\nbreak",
  ])("rejects unsafe URL %s", (value) => {
    expect(safeExternalUrl(value)).toBeNull();
  });
});
