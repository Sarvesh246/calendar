/** Runs before first paint. Navigating to Agenda always landed the tab bar
 *  correctly because that page is long enough to scroll, which makes iOS
 *  re-resolve `position: fixed` against the real window. Today and Calendar
 *  often cannot scroll, so a cold launch left the bar an inset too high
 *  until you switched tabs.
 *
 *  A 1px scroll-and-back is that same unlock, done before React boots. It
 *  does not touch `--safe-bottom`: zeroing that from `screen.height` is what
 *  sat the pill on the physical bottom edge. */
export const safeBottomInitScript = `
(function () {
  try {
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    var y = window.scrollY || 0;
    window.scrollTo(0, y + 1);
    window.scrollTo(0, y);
  } catch (e) {}
})();
`;
