-- Item completion timestamps, feed-edit snapshots, hide-completed, and push
-- subscriptions. Safe to re-run.

alter table public.items add column if not exists completed_at timestamptz;
alter table public.items add column if not exists source_snapshot jsonb;

alter table public.user_settings add column if not exists hide_completed boolean not null default false;

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists "own rows" on public.push_subscriptions;
create policy "own rows" on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table if not exists public.reminder_sends (
  key     text primary key,
  sent_at timestamptz not null default now()
);

notify pgrst, 'reload schema';
