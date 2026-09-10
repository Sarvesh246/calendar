-- How early a class heads-up lands: the Today countdown card and the reminder
-- notification (in-tab and closed-app push) both read this one number.
-- Safe to re-run.
--
-- `settings.classReminderMinutes` is local-first in Zustand, but push dispatch
-- runs on the server and has to know the user's choice, so it has to reach the
-- DB. Projects that haven't run this SQL strip `class_reminder_minutes` in
-- `STRIPPABLE_COLS` and keep syncing everything else, falling back to the
-- 10-minute default for closed-app class alerts.
alter table public.user_settings
  add column if not exists class_reminder_minutes integer not null default 10;

alter table public.user_settings
  drop constraint if exists user_settings_class_reminder_minutes_check;
alter table public.user_settings
  add constraint user_settings_class_reminder_minutes_check
  check (class_reminder_minutes >= 0 and class_reminder_minutes <= 1440);

notify pgrst, 'reload schema';
