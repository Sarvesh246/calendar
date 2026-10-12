# Security

If you find a vulnerability, please report it privately through GitHub's
[private vulnerability reporting](https://github.com/Sarvesh246/calendar/security/advisories/new)
rather than opening a public issue. Expect a first reply within a few days.

In scope: the web app, its API routes under `app/api`, and the Supabase schema and row-level security policies in `supabase/migrations`.

Secrets are never committed. The service-role key, VAPID private key and `CRON_SECRET` are server-side only.
