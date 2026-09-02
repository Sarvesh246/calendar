-- Cross-device sync hardening: deletion tombstones + honest edit timestamps.
-- Safe to re-run.
--
-- Why this exists
-- ---------------
-- 1. Without tombstones, a device that was offline when you deleted something
--    has no way to tell "deleted elsewhere" from "not uploaded yet", so its
--    reconcile pass resurrects the row. `deletions` records the fact of the
--    delete so every device can honour it.
-- 2. `set_updated_at` used to stamp now() on every UPDATE, overwriting the time
--    the edit was actually made. An offline edit from an hour ago then looked
--    newer than a fresh edit from another device the moment it was uploaded.
--    The client now sends the real edit time; the trigger only fills it in when
--    the writer didn't.

-- ---------------------------------------------------------------------------
-- 1. deletion tombstones
-- ---------------------------------------------------------------------------
create table if not exists public.deletions (
  user_id    uuid not null references auth.users(id) on delete cascade,
  entity     text not null check (entity in ('item','category','import_source','reminder_preset')),
  entity_id  text not null,
  deleted_at timestamptz not null default now(),
  primary key (user_id, entity, entity_id)
);
create index if not exists deletions_user_time_idx on public.deletions(user_id, deleted_at);

alter table public.deletions enable row level security;
drop policy if exists "own rows" on public.deletions;
create policy "own rows" on public.deletions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table public.deletions replica identity full;
do $$
begin
  begin
    alter publication supabase_realtime add table public.deletions;
  exception when duplicate_object then
    null; -- already published
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 2. let the client own `updated_at`
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  -- Keep a client-supplied timestamp that moves the row forward; otherwise
  -- stamp now(). Last-write-wins across devices compares these, so an offline
  -- edit has to keep the time it was really made.
  if new.updated_at is null or new.updated_at <= old.updated_at then
    new.updated_at = now();
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
