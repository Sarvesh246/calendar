import { isNativeWrapper, postToNative } from "@/lib/native-bridge";

/**
 * Best-effort tactile feedback. Real Taptic Engine feedback inside the
 * Calendar-ios wrapper (routed to expo-haptics via the native bridge); Safari
 * iOS otherwise ignores the Vibration API fallback, Android Chrome doesn't.
 */
export function haptic(kind: "light" | "selection" | "success" | "warn" = "light") {
  if (isNativeWrapper()) {
    postToNative("haptic", { kind });
    return;
  }
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    if (kind === "success") navigator.vibrate(12);
    else if (kind === "warn") navigator.vibrate([10, 30, 10]);
    else navigator.vibrate(8);
  } catch {
    /* ignore */
  }
}
