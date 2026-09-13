<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Learned User Preferences

- Commit and push completed work directly to `main` after a verification pass; do not wait to be asked twice.
- Treat Datebook as a daily-use calendar/todo: native iOS-like polish, refined animations, and satisfying controls over generic web UI.
- Keep the full month grid visible without scrolling the calendar itself on both desktop and mobile; scroll only inside a selected day's event list.
- Never clip overflowing day-cell items; show a `+n` overflow count for the rest.
- Appearance themes should stay tasteful, intentional, and consistent across every surface.
- Assignment status (todo / in progress / done) must have distinct, animated UI — not just completed vs to-do.
- The AI assistant must treat completed items as done (not overdue/due) and answer from full calendar/account context (including syllabus-imported items); keep the current response formatting.
- On desktop, the AI assistant is a tall conversation column, not a mobile-sized centered popup; on phone it stays a compact bottom sheet.
- Happening Now should put class meetings first and treat multiple live items as a swipeable stacked deck (touch and trackpad).

## Learned Workspace Facts

- The product is Datebook (`datebook-app`): a local-first PWA calendar and assignment tracker.
- Primary persistence is Zustand + `localStorage` (`datebook-store`); optional Supabase adds Google OAuth, Postgres+RLS, and realtime sync. The app runs fully offline without Supabase env vars.
- Main routes are `/today`, `/calendar`, `/agenda`, and `/settings`; `/` redirects to `settings.landingView`.
- Items are `event | assignment | task` with status `todo | doing | done`.
- AI runs through `/api/assistant` (Gemini); calendar import is ICS (Canvas/Google/Outlook) via `/api/import-calendar`; syllabus PDFs go through `/api/import-syllabus` (Gemini), attach per class, and are de-duped against existing items — PDFs are not stored.
- Class meeting times are a separate feature (`lib/class-schedule.ts`, class-schedule sheet): add manually or by pasting/asking the assistant. Syllabus import is due dates/assignments, not weekly meeting times.
- Auth is Google OAuth only via Supabase — no email/password. Guest Sign in CTAs start that OAuth flow directly rather than routing to collapsed Settings.
- Production deploys from `main` on Vercel.
- Closed-app reminders use web-push and `/api/push/dispatch`; in-tab reminders still use client timers.
- Class heads-up timing is one setting (`settings.classReminderMinutes`, default 10): it sets both the Today countdown card's window and the class reminder's offset. The reminder is synthesized from the setting in `lib/class-reminder.ts` — never stored on the item — so the client timers and the push dispatcher each rebuild it, and re-timing needs no item writes.
- Drizzle/Neon (`lib/db`, `DATABASE_URL`) is unused leftover; do not treat it as the live database.
- On desktop, the selected day's details open in a right sidebar; the month grid should fill the viewport. Sidebar item cards keep their natural height (including when one is expanded) and the list scrolls — never shrink-to-fit.
- On desktop Settings, the two columns expand independently so opening a card on one side does not push down cards in the other column.
- Mobile view state (tab scroll, calendar anchor/selected day, phone-schedule weekday, class filter) is remembered in `sessionStorage` via `lib/view-state.ts`; `components/view-state-sync.tsx` hydrates the filter after mount. Calendar month/week mode is *not* there — `useWorkspacePrefs` owns and persists it. Never restore from it in a `useState` initialiser — that runs on the server too and hydration mismatches.
- On phones the quick-add composer shows live Day/Class/Reminder chips (`components/composer-chips.tsx`) and saves in **one tap** — there is no preview step; desktop keeps the preview card. What each chip resolves to comes from `lib/composer-fields.ts`: an override beats the typed sentence, which beats the context (the calendar's selected day, a single filtered class), which beats the app default. The Class chip must name the class the item will *actually* get, `fallbackCategoryId` included — a chip that says "No class" while the item lands in the first class is the chip lying about its one job.
- Item cards carry named Start/Reschedule buttons on mobile (`components/mobile-quick-actions.tsx`) beside the complete circle; swipe is a shortcut, never the only route. Because a `role="button"` card takes its accessible name from its contents, both card types set an explicit `aria-label` — without it the card announces its own buttons' labels as its name, and steals their clicks.
- `mobileReschedule(item, date, planWork)` is two destinations, not a mode: "Plan a work session" adds a separate task and never moves the deadline; "Move the deadline" does, and is styled `warn`. Never collapse them back into one control.
- `useCompletionLinger` (folded into `useFilteredItems`) holds a just-completed item in the list for ~560ms so its tick and strike-through can play before "hide completed" removes it.
- `MobileItemSheet` is the one bottom sheet: scrim tap, Escape, close button and flick-down all dismiss it, and the grabber really drags. The day sheet has two detents (`compact` keeps the month visible, `full` is for reading); prev/next travel the heading in the direction the day moved.
- Toasts share one stack in `ToastViewport` (undo first, save status last) — nothing else may pin itself above the tab bar, or they overlap. `:root.scroll-locked` hides the save pill while any sheet is open; the undo snackbar stays, because it is actionable.
- Unfinished text in quick add and the assistant is kept in `lib/drafts.ts` (`sessionStorage`, one key per surface). Cancelling keeps the draft; a successful add clears it. An empty quick-add prefill means "open the composer", not "wipe it".
- Filters are three things that behave alike: the active saved view (`ui-store.activeViewId`/`viewFilter`), the class filter (`ui-store.categoryFilter`) and `settings.hideCompleted`. Anything that reports or clears filters must cover all three — a view sets classes *and* status/kind/range, so clearing classes alone leaves it quietly in force. `lib/filter-summary.ts` turns both into the "2 classes · Incomplete" line shown by `FilterSummaryBar` on every phone tab; `lib/filters.ts` `filterBreakdown()` (via the `useFilterBreakdown` hook, which shares its inputs with `useFilteredItems`) says what each one is hiding so an empty list can name its own cause (`lib/empty-state-copy.ts` → `ListEmptyState`).
- Overlapping events on a phone are explained in words, not drawn: `lib/overlap.ts` finds concurrent runs and `OverlapNotices` renders the "2 events overlap" disclosure above day lists.
- `/schedule` on phones is `components/schedule/phone-schedule.tsx` — a week strip plus a proportional day timeline; the desktop grid is unchanged from `md` up.
- Save/offline feedback is `lib/save-status.ts` + `SaveStatusPill`, driven by `store.queuedWrites` and `store.online` (both transient, published from the flush queue). It only speaks after the session's first write.
- Every theme's `--ink-faint` is tuned to clear WCAG AA (≥4.5:1) on both `--surface` and `--surface-base`; custom themes get the same guarantee from `ensureReadable()` in `lib/custom-theme.ts`, with cards as the hard requirement and the backdrop best-effort. Re-check with a contrast script before changing a preset's ink tiers.
- Height animations are not transforms, so `MotionConfig reducedMotion="user"` does not cover them — guard them with `prefersReducedMotion()` by hand.
- Cloud writes go through `lib/db-sync.ts`. Every row mapper must emit the same key set for every row (PostgREST rejects a mixed-key bulk upsert) and must never emit null for a NOT NULL column; new columns go in a numbered `supabase/migrations/*.sql` **and** in `STRIPPABLE_COLS` so a project that hasn't run the SQL degrades instead of stalling the queue.
