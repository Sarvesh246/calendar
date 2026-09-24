-- Provider-neutral assistant history and server-side confirmation queue.

create table if not exists public.assistant_threads (
  id         uuid primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);
create index if not exists assistant_threads_user_time_idx
  on public.assistant_threads(user_id, updated_at desc);

create table if not exists public.assistant_messages (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  thread_id   uuid not null references public.assistant_threads(id) on delete cascade,
  role        text not null check (role in ('user','assistant','tool')),
  content     jsonb not null,
  provider_id text,
  model_id    text,
  created_at  timestamptz not null default now()
);
create index if not exists assistant_messages_thread_time_idx
  on public.assistant_messages(user_id, thread_id, created_at);

create table if not exists public.assistant_pending_actions (
  id         uuid primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  thread_id  uuid not null references public.assistant_threads(id) on delete cascade,
  tool_name  text not null,
  arguments  jsonb not null,
  summary    text not null,
  status     text not null default 'pending' check (status in ('pending','applied','dismissed')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
create index if not exists assistant_pending_user_idx
  on public.assistant_pending_actions(user_id, status, expires_at);

alter table public.assistant_threads enable row level security;
alter table public.assistant_messages enable row level security;
alter table public.assistant_pending_actions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['assistant_threads','assistant_messages','assistant_pending_actions']
  loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format($f$
      create policy "own rows" on public.%I
        for all to authenticated
        using (user_id = (select auth.uid()))
        with check (user_id = (select auth.uid()))
    $f$, t);
  end loop;
end $$;

notify pgrst, 'reload schema';
