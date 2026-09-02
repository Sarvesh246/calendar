-- Mobile day-details preference, plus not-null safety nets on categories.
-- Safe to re-run.
--
-- `user_settings.mobile_day_details` shipped in the client before it existed in
-- this schema, so every settings write failed with:
--   Could not find the 'mobile_day_details' column of 'user_settings' (PGRST204)
-- and, because settings ride in the same batch as items and categories, that
-- single missing column stalled the whole sync queue.
alter table public.user_settings
  add column if not exists mobile_day_details text not null default 'sheet';

alter table public.user_settings
  drop constraint if exists user_settings_mobile_day_details_check;
alter table public.user_settings
  add constraint user_settings_mobile_day_details_check
  check (mobile_day_details in ('sheet', 'inline'));

-- Defaults on the two NOT NULL category columns. The client now repairs a
-- category that lost its name or colour before writing it, but a default means
-- an older build (or a hand-edited backup) degrades to a grey "Uncategorized"
-- row instead of wedging the queue on a not-null violation.
alter table public.categories alter column name  set default 'Uncategorized';
alter table public.categories alter column color set default '#8E8E93';

notify pgrst, 'reload schema';
