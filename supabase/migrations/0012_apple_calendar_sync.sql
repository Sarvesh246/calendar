alter table public.user_settings
  add column if not exists apple_calendar_sync boolean not null default false;
