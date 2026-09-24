alter table public.user_settings
  add column if not exists live_activity_enabled boolean not null default true,
  add column if not exists live_activity_privacy text not null default 'show'
    check (live_activity_privacy in ('show', 'hide'));
