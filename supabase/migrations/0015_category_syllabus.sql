-- Course details read from an imported syllabus (staff, grading, policies,
-- key dates), so the assistant can answer syllabus questions on-device.
alter table public.categories add column if not exists syllabus jsonb;
