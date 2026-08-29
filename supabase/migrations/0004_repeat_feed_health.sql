-- Repeat series, feed health, onboarding flag, durable rate limits, reminder_sends RLS.
-- Safe to re-run.

alter table public.items add column if not exists repeat jsonb;
alter table public.items add column if not exists repeat_id uuid;

alter table public.import_sources add column if not exists last_error text;

alter table public.user_settings add column if not exists onboarding_dismissed boolean not null default false;

create table if not exists public.rate_limits (
  key          text primary key,
  window_start timestamptz not null,
  count        integer not null default 0
);
alter table public.rate_limits enable row level security;

alter table public.reminder_sends enable row level security;

notify pgrst, 'reload schema';
