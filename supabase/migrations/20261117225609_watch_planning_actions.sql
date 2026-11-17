create or replace function public.apply_watch_operation(p_user uuid,p_device uuid,p_op jsonb)
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
    elsif action='plan' and value in ('25','50') and existing.type in ('assignment','task') then
      insert into public.items(id,user_id,category_id,title,type,at,end_at,all_day,work_for)
      values(op_id,p_user,existing.category_id,'Work: '||existing.title,'event',changed,
        changed+make_interval(mins=>value::integer),false,item_id::text);
      result := jsonb_build_object('state','applied');
    elsif floor(extract(epoch from existing.updated_at))::bigint > base
      and not exists(select 1 from public.watch_receipts r where r.device_id=p_device
        and r.result->>'itemId'=item_id::text and r.result->>'updatedAt'=existing.updated_at::text
        and r.result->>'state'='applied') then
      result := jsonb_build_object('state','conflict');
    elsif action='reschedule' then
      -- Shift end time with start time for events, preserving their duration.
      update public.items set at=to_timestamp(value::double precision),
        end_at=case when end_at is null then null else end_at+(to_timestamp(value::double precision)-at) end
        where id=item_id and user_id=p_user;
      result := jsonb_build_object('state','applied');
    elsif action='rename' and length(trim(value)) between 1 and 240 then
      update public.items set title=trim(value) where id=item_id and user_id=p_user;
      result := jsonb_build_object('state','applied');
    elsif action='class' and exists(select 1 from public.categories where id=value::uuid and user_id=p_user and not archived) then
      update public.items set category_id=value::uuid where id=item_id and user_id=p_user;
      result := jsonb_build_object('state','applied');
    elsif action='reminder' and value in ('10','30','60','1440') then
      update public.items set reminders=jsonb_build_array(jsonb_build_object('id',op_id::text,'itemId',item_id::text,
        'offsetMinutes',value::integer,'label',value||' min before')) where id=item_id and user_id=p_user;
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
  select * into existing from public.items where id=item_id and user_id=p_user;
  if found then result := result || jsonb_build_object('itemId',item_id,'updatedAt',existing.updated_at::text); end if;
  insert into public.watch_receipts(device_id,operation_id,result) values(p_device,op_id,result);
  return result;
end $$;
notify pgrst,'reload schema';
