-- Keep a course's canonical name separate from the label shown for its meetings.
alter table public.categories add column if not exists class_title text;
