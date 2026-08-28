# Cloud sync (Supabase)

Datebook works fully offline with no account — data lives in your browser. Adding
Supabase turns on **accounts** and **live cross-device sync**: sign in with Google
and every open tab/device updates in real time, no refresh.

## 1. Create a Supabase project

1. Go to <https://supabase.com/dashboard>, create a new project (free tier is fine).
2. Wait for it to finish provisioning.

## 2. Run the schema

Dashboard → **SQL Editor** → **New query** → paste the contents of
[`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) → **Run**.

This creates the tables (`items`, `categories`, `reminder_presets`,
`import_sources`, `user_settings`), enables row-level security so each account
only sees its own data, seeds default reminder presets for every new account, and
adds the tables to the realtime publication. It is safe to re-run — and re-running
the latest version is exactly how you pick up later columns.

> **Seeing `Could not find the 'url' column of 'items' in the schema cache`
> (PGRST204)?** Your project was created before the `items.url` column existed.
> Re-run `0001_init.sql` (it now includes the column and a schema-cache reload),
> or run just [`supabase/migrations/0002_item_url.sql`](supabase/migrations/0002_item_url.sql).
> The app keeps syncing everything except item links until you do.

## 3. Add the keys

Dashboard → **Project Settings → API**. Copy **Project URL** and the
**publishable** key (`sb_publishable_…`; the legacy anon JWT also works) into
`.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
# or, legacy:  NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

Restart `next dev` (Next only reads `.env.local` at startup). This key is safe to
expose to the browser — RLS is what protects the data.

## 4. Set up Google sign-in

### a. Google Cloud Console

1. <https://console.cloud.google.com> → create/select a project.
2. **APIs & Services → OAuth consent screen** → External → fill in app name +
   support email → add your email as a test user (or publish).
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID** →
   **Web application**.
   - **Authorized JavaScript origins**: `http://localhost:3000` and your deployed
     origin.
   - **Authorized redirect URI** (exactly this — it's Supabase's callback, not
     your app):
     `https://<YOUR-PROJECT-REF>.supabase.co/auth/v1/callback`
4. Copy the **Client ID** and **Client secret**.

### b. Supabase

1. Dashboard → **Authentication → Providers → Google** → enable → paste the
   Client ID + Client secret → save.
2. Dashboard → **Authentication → URL Configuration**:
   - **Site URL**: your app origin (`http://localhost:3000` in dev, your domain
     in prod).
   - **Redirect URLs**: add every origin you sign in from — `http://localhost:3000`
     and your deployed URL.

## 5. Use it

Open the app → **Settings → Account & sync** → **Continue with Google**. You're
bounced to Google and back, signed in. On first sign-in, whatever is already in
this browser is pushed up to your account. After that, edits on any signed-in
device appear everywhere within a second.

Sign out to return to local-only mode; the data you had on the device before your
first sign-in is restored.

## Notes

- Sessions are stored in the browser (localStorage) — standard for a client-side
  PWA. There is no server component that reads your data.
- Conflict handling is last-write-wins per row. For a single person across a few
  devices this is effectively never an issue.
- The old `DATABASE_URL` / Drizzle files (`lib/db/*`, `drizzle.config.ts`) are
  leftover scaffold from the initial commit and are not used by the app.
