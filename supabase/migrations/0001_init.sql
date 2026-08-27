-- Datebook cloud schema
-- Per-user calendar data with row-level security and realtime replication.
-- Run once in the Supabase SQL editor (Dashboard → SQL → New query → paste → Run).
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- helper: keep updated_at fresh
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  color      text not null,
  archived   boolean not null default false,
  source_id  uuid,
  updated_at timestamptz not null default now()
);
create index if not exists categories_user_idx on public.categories(user_id);

create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  type        text not null check (type in ('event','assignment','task')),
  title       text not null,
  description text,
  location    text,
  at          timestamptz not null,
  end_at      timestamptz,
  all_day     boolean not null default false,
  status      text check (status in ('todo','doing','done')),
  reminders   jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  source_id   uuid,
  source_uid  text,
  updated_at  timestamptz not null default now()
);
create index if not exists items_user_idx on public.items(user_id);
create index if not exists items_user_at_idx on public.items(user_id, at);

create table if not exists public.reminder_presets (
  id            text not null,
  user_id       uuid not null references auth.users(id) on delete cascade,
  label         text not null,
  offset_minutes integer not null,
  updated_at    timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.import_sources (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  url            text not null,
  name           text not null,
  added_at       timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  item_count     integer not null default 0,
  updated_at     timestamptz not null default now()
);
create index if not exists import_sources_user_idx on public.import_sources(user_id);

create table if not exists public.user_settings (
  user_id                    uuid primary key references auth.users(id) on delete cascade,
  preset                     text not null default 'minimal',
  landing_view               text not null default 'today',
  density                    text not null default 'comfortable',
  week_starts_on             integer not null default 0,
  clock_24h                  boolean not null default false,
  show_location              boolean not null default true,
  show_category_dot          boolean not null default true,
  default_reminder_preset_ids jsonb not null default '["rp-night"]'::jsonb,
  updated_at                 timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['categories','items','reminder_presets','import_sources','user_settings']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- row-level security: a user sees and writes only their own rows
-- ---------------------------------------------------------------------------
alter table public.categories       enable row level security;
alter table public.items            enable row level security;
alter table public.reminder_presets enable row level security;
alter table public.import_sources   enable row level security;
alter table public.user_settings    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['categories','items','reminder_presets','import_sources','user_settings']
  loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format($f$
      create policy "own rows" on public.%I
        for all to authenticated
        using (user_id = (select auth.uid()))
        with check (user_id = (select auth.uid()))
    $f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- seed defaults whenever a new account is created
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_settings (user_id) values (new.id)
    on conflict (user_id) do nothing;
  insert into public.reminder_presets (id, user_id, label, offset_minutes) values
    ('rp-15m',   new.id, '15 minutes before',  15),
    ('rp-1h',    new.id, '1 hour before',      60),
    ('rp-night', new.id, 'Night before (9pm)', 720),
    ('rp-week',  new.id, '1 week before',      10080)
  on conflict (user_id, id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- realtime: full row images so DELETE/UPDATE payloads carry user_id,
-- and add the tables to the realtime publication
-- ---------------------------------------------------------------------------
alter table public.categories       replica identity full;
alter table public.items            replica identity full;
alter table public.reminder_presets replica identity full;
alter table public.import_sources   replica identity full;
alter table public.user_settings    replica identity full;

do $$
declare t text;
begin
  foreach t in array array['categories','items','reminder_presets','import_sources','user_settings']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      null; -- already published
    end;
  end loop;
end $$;
