/** Best-effort tactile feedback. Safari iOS ignores this; Android Chrome doesn't. */
export function haptic(kind: "light" | "success" | "warn" = "light") {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    if (kind === "success") navigator.vibrate(12);
    else if (kind === "warn") navigator.vibrate([10, 30, 10]);
    else navigator.vibrate(8);
  } catch {
    /* ignore */
  }
}
