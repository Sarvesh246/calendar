/** Runs before first paint so a cold PWA launch does not flash the pill 34px
 *  too high while React is still booting. Same rule as `resolveSafeBottom`. */
export const safeBottomInitScript = `
(function () {
  try {
    var nav = window.navigator;
    var standalone = nav.standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.matchMedia("(display-mode: minimal-ui)").matches;
    if (!standalone || !window.matchMedia("(max-width: 767px)").matches) return;
    var s = window.screen;
    if (!s || !s.width || !s.height) return;
    var long = Math.max(s.width, s.height);
    var short = Math.min(s.width, s.height);
    var portrait = window.matchMedia("(orientation: portrait)").matches;
    var screenH = portrait ? long : short;
    var screenW = portrait ? short : long;
    var root = document.documentElement;
    if (Math.abs(screenW - root.clientWidth) > 2) return;
    var gap = screenH - root.clientHeight;
    if (gap >= 18 && gap <= 40) root.style.setProperty("--safe-bottom", "0px");
  } catch (e) {}
})();
`;
