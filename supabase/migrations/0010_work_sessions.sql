-- Planned work sessions: an event that blocks out time for an assignment or
-- task ("write essay Tuesday afternoon") without touching its deadline
-- ("essay due Friday"). `work_for` holds the id of the item the time serves.
-- Safe to re-run.
--
-- No foreign key: items sync independently and a session may briefly arrive
-- before (or outlive) the assignment it points at. Projects that haven't run
-- this SQL strip `work_for` in `STRIPPABLE_COLS`; sessions still sync as plain
-- events, they just lose the link on other devices.
alter table public.items
  add column if not exists work_for text;

notify pgrst, 'reload schema';
