-- Assignments imported from a Canvas (or other iCal) feed carry a link back to
-- the source page. Store it so the item detail view can link out to it.
alter table public.items add column if not exists url text;
