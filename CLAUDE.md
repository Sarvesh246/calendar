@AGENTS.md

# CLAUDE.md

## Stack

* TypeScript 5, Next.js 16 (App Router) + React 19, Tailwind CSS 4, Zustand 5, framer-motion 13; npm (`package-lock.json`), Node 24
* Optional Supabase (Google OAuth, Postgres + RLS, realtime); AI via Gemini; deployed on Vercel from `main`
* Scripts: `npm run dev`, `npm run build`, `npm run lint`, `npm test` (Vitest)

## Layout

* `app/` — routes (`/today`, `/calendar`, `/agenda`, `/schedule`, `/settings`) and API routes (`app/api/*`)
* `components/` — UI; tab pages live in `components/pages/` and are hosted by `TabPageHost`
* `lib/` — store, sync, date/filter logic, hooks; unit tests sit beside the code as `lib/*.test.ts`
* `supabase/migrations/` — numbered SQL migrations
* `public/` — PWA manifest, icons, service worker (`sw.js`)

## Hard rules

* Verify before shipping: `npx tsc --noEmit`, lint the touched files, and check previewable changes in the browser. Then commit and push to `main`.
* Never rename persisted store keys (`datebook-store`, `category`, `viewFilter`); user-facing copy says **Classes** and **Views**.
* New DB columns need a numbered migration **and** an entry in `STRIPPABLE_COLS` (`lib/db-sync.ts`).
* Animate `transform` / `opacity` only on hot paths; selected-segment highlights use `useSlidingPill` (`lib/sliding-pill.ts`), not framer `layoutId`.

## Token efficiency

Pick the cheapest model that can do the job:

* Haiku — bulk mechanical work: exploration, file reads, test runs, formatting. Never spawns subagents.
* Sonnet — scoped research, synthesis, multi-file edits. (Default.)
* Opus — architecture decisions and genuinely hard reasoning only.
* Max spawn depth 2 (main → subagent → one more tier). A subagent that needs a smarter model returns to the parent instead of escalating on its own.
* Prefer CLI tools (`rg`, `gh`) over MCP equivalents when both exist. Batch independent tool calls in parallel.

## Skills

* None project-specific yet. Add entries as `<name>` (`~/.claude/skills/<name>/SKILL.md`) — one-line trigger.
