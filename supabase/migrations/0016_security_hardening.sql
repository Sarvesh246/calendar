-- Atomic server-only rate limits for costly proxy routes.
-- The previous select-then-update sequence could be bypassed with concurrent
-- requests. This function performs the check and increment in one upsert.

create or replace function public.consume_rate_limit(
  p_key text,
  p_max integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bucket_start timestamptz;
  next_count integer;
begin
  if p_key is null or length(p_key) > 240 or p_max < 1 or p_window_seconds < 1 then
    return false;
  end if;

  bucket_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits as limits (key, window_start, count)
  values (p_key, bucket_start, 1)
  on conflict (key) do update
    set window_start = case
          when limits.window_start < bucket_start then bucket_start
          else limits.window_start
        end,
        count = case
          when limits.window_start < bucket_start then 1
          else least(limits.count + 1, p_max + 1)
        end
  returning count into next_count;

  return next_count <= p_max;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public;
revoke all on function public.consume_rate_limit(text, integer, integer) from anon;
revoke all on function public.consume_rate_limit(text, integer, integer) from authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

notify pgrst, 'reload schema';
