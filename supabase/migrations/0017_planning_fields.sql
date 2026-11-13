-- Planning details on assignments and tasks: a priority, a rough effort
-- estimate (minutes) and a checklist of subtasks. All optional. Safe to re-run.
--
-- Projects that haven't run this SQL strip the three columns in
-- `STRIPPABLE_COLS`; the fields still work on-device, they just don't sync.
alter table public.items
  add column if not exists priority text,
  add column if not exists estimate_minutes integer,
  add column if not exists subtasks jsonb;

notify pgrst, 'reload schema';
