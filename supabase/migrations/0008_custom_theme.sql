-- Custom appearance palette (background, surface, accent).
-- Safe to re-run.
--
-- `settings.customTheme` is local-first in Zustand, but a settings upsert that
-- omitted this column still replaced the whole row on realtime echo and wiped
-- the picks. Projects that haven't run this SQL strip `custom_theme` in
-- `STRIPPABLE_COLS` and keep syncing everything else.
alter table public.user_settings
  add column if not exists custom_theme jsonb;

notify pgrst, 'reload schema';
