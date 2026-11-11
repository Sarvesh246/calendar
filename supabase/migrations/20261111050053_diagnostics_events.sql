create extension if not exists pg_cron with schema pg_catalog;

create table public.diagnostic_batches (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  device_id uuid not null,
  session_id uuid not null,
  events jsonb not null check (jsonb_typeof(events) = 'array' and jsonb_array_length(events) between 1 and 40)
);
create index diagnostic_batches_received_at_idx on public.diagnostic_batches(received_at);
create index diagnostic_batches_device_time_idx on public.diagnostic_batches(device_id, received_at desc);
alter table public.diagnostic_batches enable row level security;
revoke all on public.diagnostic_batches from public, anon, authenticated;
grant insert, select, delete on public.diagnostic_batches to service_role;
grant usage, select on sequence public.diagnostic_batches_id_seq to service_role;
select cron.schedule('datebook-diagnostics-retention', '23 3 * * *',
  $$delete from public.diagnostic_batches where received_at < now() - interval '30 days'$$);
