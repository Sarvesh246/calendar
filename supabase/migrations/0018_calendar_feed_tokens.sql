-- Subscribable calendar feed. One secret token per user; the token alone
-- authorises read-only access to that user's calendar as .ics at
-- /api/calendar-feed/<token>, so Google/Apple/Outlook can subscribe by URL.
-- Regenerating replaces the row (the old URL stops working); deleting it turns
-- the feed off. The feed route reads with the service role, so the table is
-- only ever written by its owner. Safe to re-run.

create table if not exists public.calendar_feed_tokens (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  token      text not null unique,
  created_at timestamptz not null default now()
);

alter table public.calendar_feed_tokens enable row level security;
drop policy if exists "own rows" on public.calendar_feed_tokens;
create policy "own rows" on public.calendar_feed_tokens
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

notify pgrst, 'reload schema';
