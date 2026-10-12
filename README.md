# Datebook

A local-first calendar and assignment tracker for students. It runs entirely in the browser (installable as a PWA) and can optionally sync across devices through Supabase. Live at [datebookcalendar.vercel.app](https://datebookcalendar.vercel.app).

An iOS wrapper app lives in [calendar-ios](https://github.com/Sarvesh246/calendar-ios). It loads this site in a WebView and adds native reminders, widgets and Live Activities.

## What it does

- Items are `event`, `assignment` or `task`, with status `todo`, `doing` or `done`.
- Today, Calendar (month and week), Agenda and a weekly class Schedule.
- Import from ICS feeds (Canvas, Google, Outlook) and from syllabus PDFs.
- An assistant that answers common questions on-device and only calls a model for the rest.
- Reminders in the open tab, and closed-app web push when configured.

## Prerequisites

- Node 24 (see `.nvmrc`) and npm
- Optional: a Supabase project, a Gemini API key, and VAPID keys. With none of them the app runs fully offline.

## Getting started

```bash
npm install
cp .env.example .env.local   # every variable is optional
npm run dev
```

Open <http://localhost:3000>.

### Environment variables

All variables are documented in [`.env.example`](.env.example). The ones that switch features on:

| Variable                                                           | Enables                                                                                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Google sign-in and cloud sync. Schema setup is in [SUPABASE_SETUP.md](SUPABASE_SETUP.md).                                                         |
| `SUPABASE_SERVICE_ROLE_KEY`                                        | Server-only: push dispatch and rate limiting. Never expose it to the browser.                                                                     |
| `GEMINI_API_KEY`                                                   | Assistant and syllabus import. `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `MISTRAL_API_KEY` and `NVIDIA_API_KEY` are fallbacks for the assistant router. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET` | Closed-app reminders over web push.                                                                                                               |

## Scripts

| Command                           | What it does                             |
| --------------------------------- | ---------------------------------------- |
| `npm run dev`                     | Dev server                               |
| `npm run build` / `npm start`     | Production build and server              |
| `npm run typecheck`               | `tsc --noEmit`                           |
| `npm run lint`                    | ESLint                                   |
| `npm run format` / `format:check` | Prettier                                 |
| `npm test`                        | Vitest                                   |
| `npm run security:secrets`        | Scan tracked files for committed secrets |

## How it is put together

- **State** lives in a Zustand store persisted to `localStorage` (`datebook-store`). Supabase sync is layered on top, not underneath: the app never needs the network to work.
- **Sync** (`lib/db-sync.ts`) is last-write-wins on `updatedAt` with tombstones for deletes. A new database column needs a numbered migration in `supabase/migrations/` and an entry in `STRIPPABLE_COLS`, so a project that has not run the SQL yet degrades instead of stalling the write queue.
- **The assistant** (`lib/local-assistant.ts`) answers date, grade, syllabus and planning questions locally. Anything it cannot answer goes to `/api/assistant`, which routes across providers in `lib/llm/`.
- **Motion** is spring-based and shared: tokens in `lib/motion.ts`, gesture math in `lib/gesture.ts`. Hot paths animate only `transform` and `opacity`.
- **Closed-app reminders** use web push from `/api/push/dispatch`, called every ten minutes by the `Push dispatch` workflow.

```
app/          routes and API handlers
components/   UI; tab pages are in components/pages
lib/          store, sync, date logic, assistant; tests sit beside the code
supabase/     numbered SQL migrations
public/       manifest, icons, service worker
```

## Push dispatch

`POST /api/push/dispatch` refuses unauthenticated calls once push is configured. The shared secret has to exist in both places, set to the same string:

| Where             | What to set                                       |
| ----------------- | ------------------------------------------------- |
| Vercel project    | environment variable `CRON_SECRET`, then redeploy |
| GitHub repository | Actions secret `CRON_SECRET`                      |

If either side is missing or they disagree, the endpoint answers `401` and every scheduled run fails with a named error.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Commits follow [Conventional Commits](https://www.conventionalcommits.org/) and are checked by a git hook and in CI.

## License

[MIT](LICENSE)
