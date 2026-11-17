-- Per-watch, revocable credentials. Only the SHA-256 digest is stored.
alter table public.items add column if not exists status_at timestamptz;
create table public.watch_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Garmin watch',
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index watch_devices_user_idx on public.watch_devices(user_id);
alter table public.watch_devices enable row level security;
grant select,insert,update on public.watch_devices to authenticated;
create policy watch_owner_select on public.watch_devices for select to authenticated using ((select auth.uid())=user_id);
create policy watch_owner_insert on public.watch_devices for insert to authenticated with check ((select auth.uid())=user_id);
create policy watch_owner_update on public.watch_devices for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

-- Receipts make retries safe after the response is lost. They are not client writable.
create table public.watch_receipts (
  device_id uuid not null references public.watch_devices(id) on delete cascade,
  operation_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(device_id,operation_id)
);
alter table public.watch_receipts enable row level security;
revoke all on public.watch_receipts from anon,authenticated;

-- Called exclusively by the server after validating the device token.
-- Row locking + receipts provide atomic conflict handling and idempotency.
create function public.apply_watch_operation(p_user uuid,p_device uuid,p_op jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  existing public.items%rowtype;
  receipt jsonb;
  result jsonb;
  op_id uuid := (p_op->>'id')::uuid;
  item_id uuid := (p_op->>'itemId')::uuid;
  action text := p_op->>'action';
  value text := p_op->>'value';
  changed timestamptz := to_timestamp((p_op->>'changedAt')::double precision);
  base bigint := (p_op->>'base')::bigint;
begin
  if not exists(select 1 from public.watch_devices where id=p_device and user_id=p_user and revoked_at is null) then
    raise exception 'unauthorized';
  end if;
  -- Serialize requests from this watch, including simultaneous retries.
  perform pg_advisory_xact_lock(hashtextextended(p_device::text,0));
  select r.result into receipt from public.watch_receipts r where device_id=p_device and operation_id=op_id;
  if found then return receipt; end if;
  if changed > now()+interval '5 minutes' or changed < now()-interval '180 days' then
    result := jsonb_build_object('state','clock-error');
  elsif action='create' then
    if length(trim(value))=0 or length(value)>240 then raise exception 'invalid title'; end if;
    if exists(select 1 from public.items where id=item_id) then
      result := jsonb_build_object('state','conflict');
    else
      insert into public.items(id,user_id,title,type,status,at,all_day,status_at)
      values(item_id,p_user,value,'task','todo',changed,true,changed);
      result := jsonb_build_object('state','applied');
    end if;
  else
    select * into existing from public.items where id=item_id and user_id=p_user for update;
    if not found then
      result := jsonb_build_object('state','deleted');
    elsif action='status' and existing.type in ('task','assignment') and value in ('todo','doing','done') then
      if existing.status_at is not null and existing.status_at > changed then
        result := jsonb_build_object('state','conflict');
      else
        update public.items set status=value,status_at=changed,
          completed_at=case when value='done' then changed else null end where id=item_id and user_id=p_user;
        result := jsonb_build_object('state','applied');
      end if;
    elsif floor(extract(epoch from existing.updated_at))::bigint > base then
      result := jsonb_build_object('state','conflict');
    elsif action='reschedule' then
      -- Shift end time with start time for events, preserving their duration.
      update public.items set at=to_timestamp(value::double precision),
        end_at=case when end_at is null then null else end_at+(to_timestamp(value::double precision)-at) end
        where id=item_id and user_id=p_user;
      result := jsonb_build_object('state','applied');
    elsif action='priority' and value in ('low','normal','high') and existing.type in ('task','assignment') then
      update public.items set priority=value where id=item_id and user_id=p_user;
      result := jsonb_build_object('state','applied');
    elsif action='subtask' and value in ('true','false') and exists(
      select 1 from jsonb_array_elements(coalesce(existing.subtasks,'[]'::jsonb)) s where s->>'id'=p_op->>'subtaskId'
    ) then
      update public.items set subtasks=(select jsonb_agg(case when s->>'id'=p_op->>'subtaskId'
        then jsonb_set(s,'{done}',to_jsonb(value::boolean)) else s end)
        from jsonb_array_elements(existing.subtasks) s) where id=item_id and user_id=p_user;
      result := jsonb_build_object('state','applied');
    else
      result := jsonb_build_object('state','invalid');
    end if;
  end if;
  insert into public.watch_receipts(device_id,operation_id,result) values(p_device,op_id,result);
  return result;
end $$;
revoke all on function public.apply_watch_operation(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.apply_watch_operation(uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
