import { MAX_FIXED_DROP, MAX_SAFE_BOTTOM } from "@/lib/viewport-offsets";

/** Runs before first paint, so the tab bar is never painted in the wrong
 *  place and then corrected.
 *
 *  Two jobs, both aimed at the same WebKit behaviour: an installed iOS app
 *  launched with `viewport-fit=cover` resolves `position: fixed` against a
 *  layout viewport that is still short by the safe areas until the viewport
 *  is exercised by a geometry change.
 *
 *  1. A 1px scroll-and-back is that geometry change — the half of "open
 *     Agenda" that actually fixed it. Today and Calendar usually have no
 *     scroll range, so lend the document a pixel for the round trip.
 *  2. Measure what is still wrong (`100vh` is the one length WebKit gets
 *     right from a cold start) and publish it as `--fixed-drop`, which the
 *     bottom chrome carries. `useKeyboardInset()` takes the value over on
 *     mount and keeps it converged from there.
 *
 *  It never touches `--safe-bottom`: zeroing that from a screen-height gap is
 *  what sat the pill on the home indicator. */
export const safeBottomInitScript = `
(function () {
  function run() {
    try {
      if (!window.matchMedia("(max-width: 767px)").matches) return;
      var root = document.documentElement;
      var host = document.body || root;

      var y = window.scrollY || 0;
      if (root.scrollHeight > root.clientHeight + 1) {
        window.scrollTo(0, y + 1);
        window.scrollTo(0, y);
      } else if (y === 0) {
        var before = root.style.minHeight;
        root.style.minHeight = (root.clientHeight + 1) + "px";
        void root.offsetHeight;
        window.scrollTo(0, 1);
        window.scrollTo(0, 0);
        root.style.minHeight = before;
      }

      var standalone =
        window.navigator.standalone === true ||
        window.matchMedia("(display-mode: standalone)").matches ||
        window.matchMedia("(display-mode: fullscreen)").matches ||
        window.matchMedia("(display-mode: minimal-ui)").matches;
      if (!standalone) return;

      var vh = document.createElement("div");
      vh.style.cssText =
        "position:fixed;left:0;top:0;width:1px;height:100vh;visibility:hidden;pointer-events:none;";
      var edge = document.createElement("div");
      edge.style.cssText =
        "position:fixed;left:0;bottom:0;width:1px;height:0;visibility:hidden;pointer-events:none;";
      var safe = document.createElement("div");
      safe.style.cssText =
        "position:fixed;left:0;bottom:0;width:1px;height:0;padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none;box-sizing:content-box;";
      host.appendChild(vh);
      host.appendChild(edge);
      host.appendChild(safe);

      var vv = window.visualViewport;
      var windowBottom = Math.max(
        vh.getBoundingClientRect().bottom,
        vv ? vv.offsetTop + vv.height : 0,
        window.innerHeight
      );
      var gap = Math.round(windowBottom - edge.getBoundingClientRect().bottom);
      var inset = Math.round(safe.getBoundingClientRect().height);
      vh.remove();
      edge.remove();
      safe.remove();

      // A viewport the browser inset for us reports no bottom inset, and its
      // gap is that inset — closing it would plant the pill on the home
      // indicator. Same guards and ceiling as resolveFixedDrop().
      if (inset === 0 && gap <= ${MAX_SAFE_BOTTOM}) return;
      if (gap >= 2 && gap <= ${MAX_FIXED_DROP}) {
        root.style.setProperty("--fixed-drop", gap + "px");
      }
    } catch (e) {}
  }
  if (document.body) run();
  else document.addEventListener("DOMContentLoaded", run, { once: true });
})();
`;
