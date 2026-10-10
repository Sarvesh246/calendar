import { isNativeWrapper, postToNative } from "@/lib/native-bridge";

/**
 * Tactile feedback, with one meaning per kind (Apple's vocabulary):
 *
 *  - `selection` a discrete value changed: a segment, a tab, a day, a detent
 *                tick while scrubbing. The lightest tap there is.
 *  - `light`     something physical happened: a sheet landed on a detent, a
 *                drag picked up or dropped, an edge was hit.
 *  - `success`   a task was completed or an action finished.
 *  - `warn`      a destructive or overriding action.
 *
 * Routing: real Taptic Engine feedback inside the Calendar-ios wrapper (via
 * the native bridge); Android's Vibration API; and on iOS Safari / the
 * installed PWA — which ignore `navigator.vibrate` — the system haptic that
 * iOS 18+ plays when a `<input type="checkbox" switch>` is toggled.
 */
export type HapticKind = "light" | "selection" | "success" | "warn";

let lastAt = 0;
let iosSwitch: HTMLLabelElement | null = null;

function isAppleTouch(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** iOS 18 Safari plays a selection haptic when a switch input flips. */
function iosSwitchTick() {
  if (typeof document === "undefined") return;
  if (!iosSwitch) {
    const label = document.createElement("label");
    label.setAttribute("aria-hidden", "true");
    label.style.display = "none";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    label.appendChild(input);
    document.head.appendChild(label);
    iosSwitch = label;
  }
  iosSwitch.click();
}

export function haptic(kind: HapticKind = "light") {
  if (isNativeWrapper()) {
    postToNative("haptic", { kind });
    return;
  }
  // Two ticks inside a few frames read as one buzzy one.
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (now - lastAt < 35) return;
  lastAt = now;

  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      if (kind === "success") navigator.vibrate([6, 40, 10]);
      else if (kind === "warn") navigator.vibrate([10, 30, 10]);
      else if (kind === "selection") navigator.vibrate(4);
      else navigator.vibrate(7);
    } catch {
      /* ignore */
    }
    return;
  }
  if (isAppleTouch()) {
    try {
      iosSwitchTick();
      // A completion gets a double tick so it reads as more than a selection.
      if (kind === "success" || kind === "warn") window.setTimeout(iosSwitchTick, 90);
    } catch {
      /* ignore */
    }
  }
}
