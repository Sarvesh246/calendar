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
- The AI assistant must treat completed items as done (not overdue/due) and answer from situational calendar context; keep the current response formatting.

## Learned Workspace Facts

- The product is Datebook (`datebook-app`): a local-first PWA calendar and assignment tracker.
- Primary persistence is Zustand + `localStorage` (`datebook-store`); optional Supabase adds Google OAuth, Postgres+RLS, and realtime sync. The app runs fully offline without Supabase env vars.
- Main routes are `/today`, `/calendar`, `/agenda`, and `/settings`; `/` redirects to `settings.landingView`.
- Items are `event | assignment | task` with status `todo | doing | done`.
- AI runs through `/api/assistant` (Gemini); calendar import is ICS (Canvas/Google/Outlook) via `/api/import-calendar`.
- Auth is Google OAuth only via Supabase — no email/password.
- Production deploys from `main` on Vercel.
- Closed-app reminders use web-push and `/api/push/dispatch`; in-tab reminders still use client timers.
- Drizzle/Neon (`lib/db`, `DATABASE_URL`) is unused leftover; do not treat it as the live database.
- On desktop, the selected day's details open in a right sidebar; the month grid should fill the viewport.
