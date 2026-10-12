# Interaction physics audit

Audit only, nothing here has been changed yet. It records how each gesture, press, transition and feedback moment in Datebook behaves today, measured where possible, and what the physics pass should change for each one.

Markers: **[verified]** was confirmed in the running app. **[code]** was read from source and is certain. **[likely]** is inferred from source and should be confirmed on a device before you fix it.

---

## 0. The ten that matter most

| #   | Problem                                                                                                                                                                                                                                              | Where                                                                                                                                                | Why it matters                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **No spring in the app ever overshoots.** All four shared springs are critically damped or overdamped (ζ 1.00 to 1.12), so "snappy" has the same settle time as "spring" and the check mark, chips and badges never pop.                             | [lib/motion.ts:29](../lib/motion.ts:29)                                                                                                              | The whole app decelerates without ever settling, which is why it reads as computed rather than physical. This is the single biggest change to the overall feel. |
| 2   | **Velocity is dropped every time a gesture ends.** A flick-dismissed sheet hands over to a 0.26s ease-in tween, and toasts fly off with a fixed 0.18s ease-in. Ease-in starts at zero speed, so the object visibly catches and then speeds up again. | [mobile-item-sheet.tsx:81](../components/mobile-item-sheet.tsx:81), [sync-notice-toast.tsx:133](../components/sync-notice-toast.tsx:133), all sheets | The moment you let go is the moment people feel most, and right now it stutters.                                                                                |
| 3   | **Sheets don't stay under the finger.** With `dragElastic.bottom: 0.72` the sheet moves 72px for every 100px of drag, even downward, which is the direction you're allowed to drag.                                                                  | [sheet-gesture.ts:30](../lib/sheet-gesture.ts:30)                                                                                                    | It feels mushy and loosely attached. A dismiss drag should track 1:1.                                                                                           |
| 4   | **The scrim doesn't follow the sheet drag**, and on the day sheet the dim and blur jump in a single frame when the detent changes.                                                                                                                   | [ui/scrim.tsx:52](../components/ui/scrim.tsx:52), [day-sheet.tsx:168](../components/day-sheet.tsx:168)                                               | Pulling a sheet halfway should uncover the page halfway. Today the backdrop is either fully on or fully off.                                                    |
| 5   | **Settings accordions animate as a discrete flip.** `0fr → minmax(0,max-content)` can't be interpolated, so the card waits about 110ms and then snaps fully open or shut.                                                                            | [settings/page.tsx:905](../app/settings/page.tsx:905)                                                                                                | **[verified]** Measured in the running app: 0px at 20ms, 2199px at 110ms. It's worse than having no animation at all, because it adds a delay.                  |
| 6   | **A stale velocity reading can commit a tab swipe you didn't throw.** Velocity is only updated on `pointermove`, so if you drag, pause, then lift, the last speed before the pause is still treated as a flick.                                      | [use-tab-page-swipe.ts:73](../lib/use-tab-page-swipe.ts:73), [sidebar.tsx:419](../components/sidebar.tsx:419)                                        | Unexpected page changes break trust in the most-used gesture in the app.                                                                                        |
| 7   | **The month grid hard-cuts on Prev, Next, Today, ←/→ and Jump.** Only the swipe animates, and the grid only swaps after the spring has fully settled.                                                                                                | [calendar-page.tsx:378](../components/pages/calendar-page.tsx:378), [month-view.tsx:472](../components/calendar/month-view.tsx:472)                  | The same action looks different depending on how you trigger it, and swiping quickly through several months stalls.                                             |
| 8   | **The outgoing page vanishes on a committed tab swipe.** When you release, the old page goes hidden through `Activity` and only the incoming page finishes sliding, so the trailing part of the screen is empty during the settle.                   | [use-tab-page-swipe.ts:155](../lib/use-tab-page-swipe.ts:155)                                                                                        | **[likely]** The page splits in two right when the gesture should feel most continuous.                                                                         |
| 9   | **The Up Next deck barely moves under the finger**: elastic 0.18, no momentum, no exit, and new cards always come in from the right, even when you swipe backward.                                                                                   | [up-next-card.tsx:185](../components/up-next-card.tsx:185)                                                                                           | This is meant to be a card stack you can throw. Right now it feels stuck.                                                                                       |
| 10  | **Completed cards leave by accelerating into a hard stop.** Height collapses with a 160ms ease-in, so the list below slams into place.                                                                                                               | [item-card.tsx:39](../components/item-card.tsx:39)                                                                                                   | Completion is the most rewarding moment in a todo app, and it ends with a jolt.                                                                                 |

---

## 1. Foundation: what the physics actually is today

### 1.1 Springs, measured

These are computed from stiffness, damping and mass. Settle time is the time to come within 1% of the target.

| Token / site          | ζ (damping ratio) | Overshoot | Settle    | Used for                                               |
| --------------------- | ----------------- | --------- | --------- | ------------------------------------------------------ |
| `motion.spring`       | 1.01              | 0%        | 220ms     | toasts, cards, menus, toggle knob, chevrons            |
| `motion.springSnappy` | **1.12**          | 0%        | 220ms     | check mark, chip dots, context menu, month swipe, deck |
| `motion.springGentle` | 1.00              | 0%        | 355ms     | every bottom sheet, focus card                         |
| `motion.springLayout` | 1.12              | 0%        | 369ms     | Reveal, filter bar, composer panels                    |
| Tab pill, v > 1800    | 0.63              | 8.1%      | 317ms     | tab bar flick                                          |
| Tab pill, v > 900     | 0.80              | 1.6%      | 271ms     | tab bar flick                                          |
| Tab pill, tap/slow    | 1.11              | 0%        | 276ms     | tab bar tap                                            |
| Page swipe ×3 bands   | 0.85 to 1.11      | ≤0.6%     | 247–321ms | tab page settle                                        |
| Boot splash mark      | 0.69              | 4.9%      | 371ms     | launch                                                 |

What this shows:

- **`springSnappy` isn't snappier than `spring`.** Its higher stiffness is cancelled out by heavier damping, so both settle in about 220ms. The names promise a hierarchy the numbers don't deliver.
- **Overshoot only happens on a tab-bar flick or at launch.** Everything you tap (completing, toggling, selecting, opening) lands with zero life.
- **The velocity bands in [tab-swipe.ts:95](../lib/tab-swipe.ts:95) are discontinuous.** A flick at 899px/s and one at 901px/s get visibly different springs. A single underdamped spring that is given the velocity already overshoots more on a harder throw, so the bands aren't needed.

### 1.2 Tweens

`ease` = `cubic-bezier(0.2, 0.8, 0.2, 1)` is a good decelerating curve. The trouble is `easeIn` = `(0.4, 0, 1, 1)`, which is used for every exit:

- For something leaving the screen (a toast, menu or popover fading), ease-in is fine.
- For anything **already moving** (a released sheet or toast) or anything **that pushes siblings** (a height collapse), ease-in is wrong. It throws away the current velocity, or it ends at maximum speed against a hard stop.

### 1.3 How velocity is handled, per gesture

| Gesture                   | How velocity is measured   | Passed to the settle?           | Stale on hold-then-lift? |
| ------------------------- | -------------------------- | ------------------------------- | ------------------------ |
| Tab page swipe            | last two samples only      | yes                             | **yes, bug**             |
| Tab bar scrub             | last two samples only      | yes, but banded                 | **yes, bug**             |
| Sheets (Framer `PanInfo`) | Framer's windowed estimate | **no**, exit is a tween         | no                       |
| Month swipe (Framer)      | Framer                     | implicitly, through MotionValue | no                       |
| Toast fling               | Framer                     | **no**, fixed tween             | no                       |
| Up Next deck              | Framer                     | **no**, momentum off            | no                       |

### 1.4 Haptics ([lib/haptic.ts](../lib/haptic.ts))

- **On the iOS PWA there are no haptics at all**, because Safari ignores `navigator.vibrate`. Only the IPA, through the native bridge, and Android give feedback. A known workaround on iOS 18+ is to toggle a hidden `<input type="checkbox" switch>`, which produces a system haptic. It's a hack and worth testing before relying on it.
- **On Android every tap vibrates for 8ms**, because `light` is used about 60 times. That's noisy, not tactile.
- **The vocabulary doesn't match iOS semantics.** `selection` is used 3 times. Discrete value changes such as a segmented control, a calendar day, crossing a tab during a scrub, or a picker tick should use `selection`. `light` (impact) belongs to physical events: a sheet reaching a detent, picking up or dropping a drag, a rubber-band limit. Right now Segmented, month cells and tabs all use `light`.
- **The Up Next swipe fires two haptics**: `selection` in `onDragEnd` plus `light` inside `go()` ([up-next-card.tsx:97](../components/up-next-card.tsx:97), [:191](../components/up-next-card.tsx:191)).
- **The header cluster is inconsistent.** Schedule and Settings fire a haptic, but Ask, Search and Filters don't.

### 1.5 Reduced motion

This is handled well: there's a blanket CSS rule, `MotionConfig reducedMotion="user"`, and hand-written guards for height animations. Keep it. Every new primitive needs the same guard.

---

## 2. Gestures

### 2.1 Tab page swipe on phones ([use-tab-page-swipe.ts](../lib/use-tab-page-swipe.ts), [tab-page-host.tsx](../components/tab-page-host.tsx))

**Today:** axis lock at 14px with a 1.15 ratio, then the page tracks 1:1. It commits past 42% of the width, or on a flick over 720px/s once it has moved 28px. Past the first or last tab it rubber-bands linearly at ×0.22. On release it springs with the throw velocity. The neighbouring page is shown as an absolutely positioned peek.

**Problems**

- **Stale velocity** (top-10 #6). `velocity.current` is never decayed at release.
- **Velocity is estimated from the last two samples only.** It's noisy on 120Hz screens, and a single jittery sample can flip the commit decision.
- **The outgoing page vanishes on commit** (top-10 #8). `setPeek(null)` plus navigation hides the old page while the new one is still mid-flight.
- **[likely] The incoming page jumps vertically on commit.** The peek is its own `overflow-auto` box at scrollTop 0, but once it becomes active, `useTabScrollMemory` restores the document scroll to the remembered y. If you'd scrolled that tab before, the content you saw while peeking jumps.
- **The rubber-band is linear.** A ×0.22 factor never stiffens, so a long overdrag keeps going. Native rubber-banding is asymptotic: `c·d·x / (d + c·x)`, with c ≈ 0.55 and d the page width.
- **The tab bar pill doesn't move while you swipe.** It only moves after navigation commits. A pager's indicator should track page progress continuously.

**Target:** a velocity window of about 80–100ms, zeroed if the last move was more than about 50ms ago. Project the release point as `x + v·0.2` and commit against that instead of separate halfway and flick rules. Keep both pages mounted until the settle finishes. Use the asymptotic rubber-band. Feed `-x/width` into the tab pill's motion value, so the pill slides with your thumb as the page does and lands together with it.

### 2.2 Bottom tab bar scrub ([sidebar.tsx:274–584](../components/sidebar.tsx:274))

**Today:** the pill follows the finger 1:1 and rubber-bands ×0.28 past the ends. It commits on a flick or by rounding to the nearest tab, then springs with banded velocity. Press scale is 1.015.

**Problems**

- Same stale-velocity and single-sample issues as 2.1.
- **There's no detent feedback during a scrub.** The icon and label ink only flip after navigation, and there's no `selection` haptic as the pill crosses each tab. The iOS segmented and picker feel comes from those ticks.
- **The 1.015 press scale can't be seen.** The Liquid Glass reference grows the selected lens noticeably, about 1.06–1.1, and squashes it slightly along the direction of travel.
- **The active label flips to `font-semibold` and the stroke width changes from 1.85 to 2.1 instantly** ([sidebar.tsx:549](../components/sidebar.tsx:549), [:554](../components/sidebar.tsx:554)). A weight change reflows the glyph width, so the label shifts sideways by a pixel or so on every switch.
- **The pill moves through a JS `animate()` on a MotionValue**, the very main-thread path that `useSlidingPill` was written to avoid. When a tap triggers an expensive page render, the spring can drop frames.

**Target:** light up the tab under the pill live during a scrub, and fire a `selection` haptic on each boundary crossing. Keep the label weight constant and fade a second, bold layer in with opacity instead. On release, settle with a single underdamped spring that is given the velocity (ζ ≈ 0.75).

### 2.3 Bottom sheets: MobileItemSheet, FilterSheet, ClassScheduleSheet ([sheet-gesture.ts](../lib/sheet-gesture.ts))

**Today:** opens on `springGentle` from y = 100% with no overshoot, 355ms. Drag elastic is 0.72 downward and 0.04 upward. Dismiss triggers at an offset over 52px or a velocity over 520. Exit is a 0.26s ease-in tween (FilterSheet uses 0.16s). Pulling down from the top of the scroller hands over to the sheet drag.

**Problems**

- **It doesn't track 1:1 downward** (top-10 #3).
- **The exit discards velocity** (top-10 #2). There's also a race: on release, Framer starts the `dragConstraints` bounce back toward 0, and then `close()` starts the exit tween from wherever that has got to.
- **The dismiss rule ignores direction and size.** Pulling down 60px and then pushing back up still dismisses, because the offset is over 52 even though the velocity points upward. And 52px is a fixed distance no matter how tall the sheet is.
- **The scrim stays at full strength while you drag** (top-10 #4).
- **Exit durations differ between sheets**: 0.26s in MobileItemSheet, `motion.exit` (0.16s) in Filter, Day and ClassSchedule.
- **The AI drawer on phones can't be dragged to dismiss at all** ([ai-drawer.tsx](../components/ai-drawer.tsx)). It's CSS-only, which breaks the rule that all sheets share one way of being dismissed. Its `bottom` also follows `--keyboard-inset` with no transition, so it jumps whenever the keyboard opens or closes.

**Target:** build one `useSheetPhysics` primitive. Track 1:1 downward. Upward, use the asymptotic rubber-band. Project the release point as `y + vy·0.2`: past half the height (or another detent) closes it, otherwise it springs home. Close with a spring that starts from the release velocity, ζ ≈ 1, never a tween. Drive scrim opacity from `1 − y/height`. Open with slight life (ζ ≈ 0.9, about 1–2% overshoot) so the sheet lands instead of just stopping.

### 2.4 Day sheet detents ([day-sheet.tsx](../components/day-sheet.tsx))

**Today:** the compact detent (46dvh) and full detent (92dvh) are different `height` values with a 340ms CSS transition. Drag uses y with elastic 0.55 upward at compact, and moving between detents is decided on release.

**Problems**

- **Two motions happen on top of each other.** On release the y bounce-back and the height transition run at the same time, so the sheet snaps back down and grows simultaneously.
- **It doesn't follow the finger between detents.** Dragging up from compact stretches 55% and then jumps to full.
- **Height is a layout animation**: every frame reflows the sheet's contents.
- **The scrim amount jumps** from 0.35 to 1 in a single frame.
- **Changing the day** (prev/next) slides the heading 18px, but the list beneath cuts. There's no haptic and no horizontal swipe to change day (iOS Calendar has one).

**Target:** render at full height and express detents as y translations (`y = fullH − compactH` for compact). The drag moves y continuously across both detents, with rubber-banding only past the ends. On release, project the point and snap to the nearest detent with a `light` haptic. Scrim opacity is a function of y. Add a horizontal swipe on the list to step days, using the same pager physics as 2.1.

### 2.5 Month swipe ([month-view.tsx:437–480](../components/calendar/month-view.tsx:437))

**Today:** a three-panel track. The drag follows dx while `|dx| > |dy|`, with a hard clamp at 92% of the width. It commits at 18% of the width or on a flick over 620. It springs on `springSnappy`, and `onSwipeMonth` only runs after the spring has finished.

**Problems**

- **There's no axis lock.** If the finger drifts vertical partway through, `onPan` stops updating and the grid freezes mid-drag.
- **The clamp is hard.** At 92% the grid stops dead instead of resisting.
- **It commits only after the settle.** A second swipe during the overdamped tail runs against the old anchor, so swiping quickly through several months stalls. The three-panel re-render also lands on the last frame, which can hitch.
- **The buttons, keyboard, Today and Jump all hard-cut** (top-10 #7). The month branch isn't wrapped in `AnimatePresence`, and the effect at [month-view.tsx:422](../components/calendar/month-view.tsx:422) resets the track.
- **The title** animates 220ms after the commit instead of scrubbing with the drag.

**Target:** commit the anchor at release and shift `dragX` by ±width in the same frame (the re-centring trick the tab pager already uses), then spring to 0 with the velocity. Route the buttons and keyboard through the same track animation. Rubber-band past one month. Optionally, drive the title's crossfade from drag progress.

### 2.6 Up Next deck ([up-next-card.tsx](../components/up-next-card.tsx))

**Today:** `drag="x"` with elastic 0.18, momentum off, and switching at an offset over 48 or a velocity over 380. The new card enters from x = 22 regardless of direction, and the old card simply disappears. The two back cards are static divs. On a trackpad, `deltaX ≥ 28` per event triggers a fixed 380ms lock.

**Problems:** it barely moves, has no throw, no exit, the wrong entry direction, two haptics, and the back cards don't rise. The trackpad path ignores small deltas, so slow two-finger swipes often do nothing, and there's no visual follow.

**Target:** track 1:1 with rotation `x/width · 6°`. When it passes the projected threshold, fling it off with the release velocity while the next card rises (scale 0.95 → 1, y 8 → 0, spring ζ ≈ 0.8) and the back cards each step up one place. For the trackpad, accumulate wheel `deltaX` into the same MotionValue and decide 120ms after the last wheel event. Use one `selection` haptic.

**Show all / Show one** runs a `mode="wait"` fade (about 440ms) and the page height jumps. It should fan the stacked cards out into the list using a layout spring.

### 2.7 Toasts and snackbars

- **Sync notice fling** ([sync-notice-toast.tsx:133](../components/sync-notice-toast.tsx:133)): a fixed 0.18s ease-in to ±420 or ±160. **Target:** inertia or spring starting from `info.velocity`.
- **Save pill and undo snacks** ([dismissible-snack.tsx](../components/dismissible-snack.tsx)): drag-down dismiss with `dragSnapToOrigin`. That's fine, but the exit doesn't inherit velocity.
- **The bottom stack has no layout animation** ([toast-viewport.tsx](../components/toast-viewport.tsx)). When an undo expires, the save pill below jumps up. The top stack uses `layout` correctly. The viewport also animates `bottom` (a layout property) when `--toast-lift` changes.
- **The undo timer doesn't pause** while you're pressing or hovering the toast. The drain pause only applies to `.sync-notice-card`.

### 2.8 Smaller gestures

- **Reminder row swipe** ([settings/page.tsx:1460](../app/settings/page.tsx:1460)): decides from the offset only and ignores velocity. Elastic 0.04 feels like hitting a wall. It needs `dragDirectionLock`.
- **Calendar drag and drop on desktop** ([calendar-drag.ts](../lib/calendar-drag.ts), [drag-overlay.tsx](../components/drag-overlay.tsx)): the snapping, preview and haptics are good. But the source item never lifts (no scale or shadow), and on drop the ghost label vanishes and the block appears at the new slot with nothing travelling between them. On cancel, nothing flies back home. The label is positioned through a Zustand `setState` and a React render on every pointer move, and it flips sides near the right edge in a single frame.
- **Pane resize** ([workspace-pane.tsx:124](../components/calendar/workspace-pane.tsx:124)): tracks 1:1, which is good. There's no edge detent: dragging past the minimum could snap-collapse the pane with a `light` haptic, the way macOS split views do.
- **There's no long-press anywhere on phones.** The comment at [item-menu.ts:32](../lib/item-menu.ts:32) says phones keep long-press sheets, but none exist. On iOS, long-pressing a card to lift it (scale 1.03 plus shadow, an impact haptic at about 400ms, then a menu) is expected.

---

## 3. Taps and presses

| Tier                              | Today                                                         | Assessment                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Global `button` / `a` press       | scale 0.97, 80ms down and 120ms up, `ease`                    | Good. Release is slower than the press. The release could be a CSS `linear()` spring with slight overshoot, to 1.005 and back. |
| `.press-surface` (cards, cells)   | scale 0.988, 90ms                                             | Good restraint.                                                                                                                |
| `.press-pop` (card quick actions) | scale 0.88                                                    | Good.                                                                                                                          |
| Framer `whileTap`                 | Add button 0.94, settings rows 0.975, toggle knob scaleX 1.15 | These are three more systems alongside the CSS tiers.                                                                          |
| Month day cell                    | `press-none` plus `active:bg-surface-sunken`                  | Fine. The selection ring slides through `useSlidingPill` (340ms, iOS curve). Good.                                             |

**Specific issues**

- **Toggle switch** ([toggle-switch.tsx:31](../components/toggle-switch.tsx:31)): the comment says the knob "stretches toward its destination", but `scaleX` from the centre stretches both ways and only while pressed. The iOS behaviour is that the knob widens on touch-down, anchored to the side it's leaving, then slides and narrows on release.
- **Press feedback only appears on `:active`**, and on iOS Safari `:active` is delayed or skipped during a tap that ends quickly. Without `ontouchstart` on the body, or a pointerdown-driven `data-pressed`, quick taps often show no press at all.
- **Sliding pills**: `useSlidingPill` uses WAAPI with `cubic-bezier(0.32,0.72,0,1)` over 340ms, which is excellent and stays smooth under load. Keep this as the reference implementation. Two pills still use Framer `layoutId`, which breaks the project's hard rule: [phone-schedule.tsx:174](../components/schedule/phone-schedule.tsx:174) and [composer-chips.tsx:362](../components/composer-chips.tsx:362).

---

## 4. Transitions and reveals

| Surface                                       | Today                                                     | Problem                                                                                                                                                                                                                                                                         | Target                                                                                                                           |
| --------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Tab switch by tap                             | opacity 0.6 → 1 over 180ms                                | Fine, and matches your "ease, don't cut" preference. It has no sense of direction.                                                                                                                                                                                              | Optionally add a 10–12px `translate` offset toward the tab's side, on an inner wrapper to avoid the iOS containing-block clip.   |
| **Settings accordions**                       | `grid-template-rows` 0fr ↔ max-content                    | **[verified] discrete flip after about 110ms**                                                                                                                                                                                                                                  | Use `0fr ↔ 1fr` (interpolable, the same pattern as `.item-card-expand`), or measure and spring the height.                       |
| `Reveal` / FilterSummaryBar / composer panels | Framer `height: auto` on `springLayout`                   | Layout every frame, but acceptable off hot paths. The exit is a 0.16s ease-in, which crunches.                                                                                                                                                                                  | Exit with the same spring, or with ease-out.                                                                                     |
| Card expand on desktop                        | `0fr ↔ 1fr` over 220ms                                    | Correct technique.                                                                                                                                                                                                                                                              | Keep.                                                                                                                            |
| **Card exit after complete**                  | rows 1fr → 0fr plus opacity, 160ms ease-in                | Slams the siblings (top-10 #10).                                                                                                                                                                                                                                                | Fade opacity over 120ms, then collapse the height on a spring (ζ 1, about 280ms) so the siblings glide up.                       |
| **Agenda Rows (desktop table)**               | none                                                      | Completed or filtered rows **pop out instantly**: no `AnimatePresence` ([agenda-rows.tsx:156](../components/agenda-rows.tsx:156)).                                                                                                                                              | Same presence as the cards.                                                                                                      |
| Header cluster Ask hide                       | animates `grid-template-columns` over 340ms               | A layout property under a `backdrop-filter`, so it re-blurs and reflows every frame. Ask is clipped rather than fading.                                                                                                                                                         | Clip-path or a scale-based FLIP on the capsule, while Ask fades and scales to 0.8 in the first 40%.                              |
| Desktop rail collapse                         | width jumps 68 ↔ 220 in **one frame**                     | The main column reflows all at once and only the labels fade.                                                                                                                                                                                                                   | Animate the width with a FLIP on the main column, or slide the rail with a transform over a reserved gutter.                     |
| Month ↔ Week switch                           | hard cut                                                  | No spatial link.                                                                                                                                                                                                                                                                | iOS-style: the selected week row expands into the week grid (FLIP of the row's rect).                                            |
| Context menu                                  | scale 0.96, y −4, `springSnappy`                          | **`transformOrigin: top left` stays fixed even when the menu flips up or left** ([item-context-menu.tsx:171](../components/item-context-menu.tsx:171)), so it grows from the wrong corner. Moving between sections (main → reschedule → date) hard-cuts the content and height. | Set the origin to the anchor corner, and slide sections horizontally with a height spring.                                       |
| Command palette                               | CSS keyframes, translateY −22 and scale 0.96              | Good, and the Radix exit is honoured.                                                                                                                                                                                                                                           | Keep.                                                                                                                            |
| AI drawer                                     | CSS `sheet-in` 340ms on phone, `drawer-in` on desktop     | No drag (see 2.3). Messages pop in with x ±8 springs, and the thinking dots are good.                                                                                                                                                                                           | Draggable sheet. Stream or reveal the response at about 30–40 characters per frame instead of all at once.                       |
| **Quick-add composer on phones**              | drops from the top (y −10, scale 0.97, origin top centre) | **There's no spatial link: you tap + at the bottom right and a panel appears at the top.**                                                                                                                                                                                      | Grow from the + button (shared-element FLIP from the button's rect to the panel's), with the + morphing into the panel's submit. |
| Boot splash                                   | at least 420ms, plus a 480ms exit                         | Every cold launch and refresh costs about 0.9s before the page is fully visible.                                                                                                                                                                                                | Start the exit as soon as the app has hydrated, and overlap the content's entrance with the veil lifting.                        |
| Week view on phones                           | native `scroll-snap`                                      | Native physics, which is correct.                                                                                                                                                                                                                                               | Keep.                                                                                                                            |

---

## 5. Feedback moments (the itch-scratch layer)

### 5.1 Completing an item: the most important moment in the app

**Timeline today:** at t = 0 there's a `success` haptic, the ring fills (220ms), the check scales in with `springSnappy` (no overshoot) and a ripple runs (520ms). At t = 220ms the strike-through draws (220ms) and the title dims. At t = 560ms the card exits (160ms ease-in).

**What's missing**

- **The check has no overshoot.** A check that lands at 1.15 and settles back to 1 (ζ ≈ 0.5) is what makes completing something feel satisfying.
- **The ring fill is a colour tween.** A radial fill that grows from the centre (scale on an inner disc) reads as filling up.
- **The completed state only holds for about 120ms** before the exit starts. A 700–800ms total linger (the `LINGER_MS` constant) gives the strike-through time to register.
- **The exit slams** (see the transitions table).
- **There's no count feedback.** Section counts like "3 items" and the Agenda `section.count` change by text swap. A rolling digit, or a tick of the counter, closes the loop: you did one, and the number went down.

### 5.2 Other moments

- **Status → In progress**: the ring pulses (2.4s opacity), which is good. Moving from todo → doing has no transition beyond the colour.
- **Adding an item**: there's a `success` haptic. The new card doesn't announce itself in the list. A brief highlight (accent flash or scale 0.98 → 1) on the item you just created tells you where it went.
- **Undo**: the toast drain bar is good. Undoing should reverse visibly, with the card re-entering via presence, not popping in.
- **Filter badge count** ([filter-sheet.tsx:52](../components/filter-sheet.tsx:52)): scales in from 0, but the number changes by swapping text.
- **Live dot and Happening-now pulse**: good, and they respect reduced motion.
- **Empty states**: fade up 6px. Fine.

---

## 6. Scrolling

- **`overscroll-behavior: none` on `html` and `body`** ([globals.css:444](../app/globals.css:444), [:473](../app/globals.css:473)). On iOS Safari 16+ this removes the native rubber-band at the top and bottom of every page, so pages stop dead at their ends, which is the least native-feeling thing about scrolling here. It was probably added to stop pull-to-refresh or background bleed. **Test on a device** whether `overscroll-behavior-y: contain` (or simply removing it on phones) brings the bounce back without the old problem.
- **Nothing reacts to scroll.** Page titles don't condense into the header, the glass cluster doesn't strengthen its material when content passes under it, and the tab bar doesn't shrink on scroll-down (iOS 26). CSS scroll-driven animations (`animation-timeline: scroll()`) run on the compositor and cost no JavaScript. Use them sparingly; one effect (a title that condenses) already adds a lot of polish.
- **Sheet scrollers**: `overscroll-contain` plus the pull-to-dismiss handoff is correct. The handoff decision is good.
- **Scroll restoration** across tabs is solid. See 2.1 for the peek mismatch.
- **Smooth `scrollIntoView`** (Today sections, Settings anchors): uses the browser's fixed easing. Acceptable.

---

## 7. Text and numbers

- **Weight flips cause the label to shift sideways**: tab labels, `aria-current` items, and possibly Segmented if its text weight changes.
- **Changing numbers swap text instantly**: counts, "in 12 min" countdowns, the Focus timer, the `n of m` deck counter and the batch "3 selected". A small `NumberRoll` (each digit slides on y with an opacity mask, spring ζ ≈ 0.9) fits the "scratch an itch" goal for timers and counts. `tabular-nums` is already used everywhere, which is the prerequisite.
- **Titles that move with their content** (calendar month, day sheet heading) already use direction-aware variants. Good.

---

## 8. Rule violations and debt that block the pass

- Framer `layoutId` in [phone-schedule.tsx:174](../components/schedule/phone-schedule.tsx:174) and [composer-chips.tsx:362](../components/composer-chips.tsx:362) breaks the hard rule to use `useSlidingPill`.
- Layout properties animated on interactive paths: the header cluster (`grid-template-columns`), day-sheet `height`, the toast viewport's `bottom`, and the desktop rail's `width` (currently a jump).
- Four separate press systems: CSS `:active` scale, `.press-surface`, `.press-pop` and Framer `whileTap`.
- Velocity handling is re-implemented by hand in two places (the page swipe and the tab bar) with the same stale-velocity bug.

---

## 9. Proposed physics system (for the implementation pass)

### 9.1 Motion tokens, version 2 ([lib/motion.ts](../lib/motion.ts))

Use Framer's perceptual parameters (`visualDuration` and `bounce`) so each token reads like what it does:

| Token      | bounce | visualDuration | Use                                             |
| ---------- | ------ | -------------- | ----------------------------------------------- |
| `settle`   | 0      | 0.30           | height, layout, anything that pushes siblings   |
| `glide`    | 0.08   | 0.38           | sheets, pages, large surfaces                   |
| `nudge`    | 0.18   | 0.24           | controls, pills, toggles, menus                 |
| `pop`      | 0.38   | 0.22           | check marks, badges, chips, counters            |
| `throw(v)` | 0.12   | 0.32           | any gesture release. **Always takes velocity.** |

Keep the tween tokens for colour and opacity only. Reserve `easeIn` for fades of things that aren't moving.

### 9.2 Gesture kit ([lib/gesture/](../lib))

1. **`trackVelocity()`**: an 80–100ms ring buffer, zeroed when the last sample is too old. It replaces both hand-rolled estimators.
2. **`rubberband(x, dim, c = 0.55)`**: the asymptotic formula, shared by the pager, tab bar, sheets, month view and deck.
3. **`project(x, v, decel = 0.998)`**: the iOS projection, `x + v·decel/(1−decel)/1000` (about `v·0.2` at 0.998), used for every commit decision.
4. **`useSheetPhysics({ detents })`**: 1:1 tracking, projection to the nearest detent, a spring that inherits velocity, a scrim MotionValue, a `light` haptic per detent, and the overscroll handoff (moved over from `useSheetOverscroll`).
5. **`usePager()`**: re-centring commit, both pages mounted through the settle, and an exported progress MotionValue for indicators (the tab pill, the month title).
6. **`haptic.selection` / `impact` / `success`**: give each a strict meaning, plus an iOS-PWA path to evaluate.

### 9.3 Suggested order (impact against risk)

1. **Tokens v2 and the completion choreography.** This changes the feel everywhere with very little risk.
2. **The Settings accordion fix** (`0fr ↔ 1fr`) and the card-exit spring. Small changes that fix verified bugs.
3. **The velocity kit**: fixes stale velocity and the exit hand-off on sheets and toasts.
4. **`useSheetPhysics`** for all sheets including the AI drawer, with a draggable, detent-based day sheet.
5. **`usePager`** for tabs and months, with the tab pill linked to page progress and month buttons animated.
6. **The Up Next deck rebuild.**
7. **Shared-element moments**: + → composer, week row → week grid, the drag-drop settle.
8. **Scroll polish**: the overscroll bounce test on a device, plus one scroll-driven title condense.
9. **Numbers** (`NumberRoll`) and the haptic vocabulary pass.

Each step should be checked by recording the interaction (Playwright trace or a screen recording at 120fps) and comparing it frame by frame before and after, not just by eye.
