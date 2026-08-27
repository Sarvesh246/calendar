# Cloud sync (Supabase)

Datebook works fully offline with no account — data lives in your browser. Adding
Supabase turns on **accounts** and **live cross-device sync**: sign in with a
magic link and every open tab/device updates in real time, no refresh.

## 1. Create a Supabase project

1. Go to <https://supabase.com/dashboard>, create a new project (free tier is fine).
2. Wait for it to finish provisioning.

## 2. Run the schema

Dashboard → **SQL Editor** → **New query** → paste the contents of
[`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) → **Run**.

This creates the tables (`items`, `categories`, `reminder_presets`,
`import_sources`, `user_settings`), enables row-level security so each account
only sees its own data, seeds default reminder presets for every new account, and
adds the tables to the realtime publication. It is safe to re-run.

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

## 4. Auth settings

Dashboard → **Authentication → URL Configuration**:

- **Site URL**: your app origin (e.g. `http://localhost:3000` in dev, your real
  domain in prod).
- **Redirect URLs**: add every origin you'll sign in from
  (`http://localhost:3000`, `https://your-domain`, etc.).

Email is enabled by default. Supabase's built-in mailer is rate-limited (a few
per hour) — fine for personal use. For volume, set up a custom SMTP provider
under **Authentication → Emails**.

### Put the 6-digit code in the email (needed for installed PWAs)

On iOS a magic **link** opens in Safari, not your home-screen app, so the session
never reaches the PWA. The app therefore signs you in with a **code** you type
back in — but the default email only contains the link. Add the code to it:

Dashboard → **Authentication → Emails → Magic Link** → edit the template so it
includes `{{ .Token }}`, e.g.:

```html
<h2>Sign in to Datebook</h2>
<p>Enter this code in the app:</p>
<p style="font-size:24px;letter-spacing:4px"><strong>{{ .Token }}</strong></p>
<p>…or, on this device, just tap:
   <a href="{{ .ConfirmationURL }}">Sign in</a></p>
```

## 5. Use it

Open the app → **Settings → Account & sync** → enter your email → **Send code** →
type the 6-digit code from the email (or, on desktop, click the link). On first
sign-in, whatever is already in this browser is pushed up to your account. After
that, edits on any signed-in device appear everywhere within a second.

Sign out to return to local-only mode; the data you had on the device before your
first sign-in is restored.

## Notes

- Sessions are stored in the browser (localStorage) — standard for a client-side
  PWA. There is no server component that reads your data.
- Conflict handling is last-write-wins per row. For a single person across a few
  devices this is effectively never an issue.
- The old `DATABASE_URL` / Drizzle files (`lib/db/*`, `drizzle.config.ts`) are
  leftover scaffold from the initial commit and are not used by the app.
