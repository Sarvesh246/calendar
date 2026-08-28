-- Assignments imported from a Canvas (or other iCal) feed carry a link back to
-- the source page. Store it so the item detail view can link out to it.
--
-- Run this in the Supabase SQL editor if you set the project up before this
-- column existed and are seeing:
--   Could not find the 'url' column of 'items' in the schema cache (PGRST204)
alter table public.items add column if not exists url text;

-- Refresh PostgREST's cached schema so the new column is usable right away.
notify pgrst, 'reload schema';
