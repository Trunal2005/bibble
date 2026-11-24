create table public.focus_history_heads (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  generation uuid not null default gen_random_uuid()
);
create table public.focus_sessions (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  id text not null check (length(id) between 1 and 160),
  generation uuid not null,
  minutes integer not null check (minutes between 1 and 1440),
  completed_at timestamptz not null,
  room_id text check (length(room_id)<=200), room_name text check (length(room_name)<=200),
  topic text check (length(topic)<=200), note text check (length(note)<=2000),
  primary key(user_id,id)
);
create index focus_sessions_owner_time on public.focus_sessions(user_id,completed_at desc,id);
alter table public.focus_history_heads enable row level security;
alter table public.focus_sessions enable row level security;
revoke all on public.focus_history_heads, public.focus_sessions from anon;
grant select,insert,update on public.focus_history_heads to authenticated;
grant select,insert,delete on public.focus_sessions to authenticated;
create policy "Own history head" on public.focus_history_heads for all to authenticated
using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "Own current focus sessions" on public.focus_sessions for all to authenticated
using(user_id=auth.uid() and generation=(select h.generation from public.focus_history_heads h where h.user_id=auth.uid()))
with check(user_id=auth.uid() and generation=(select h.generation from public.focus_history_heads h where h.user_id=auth.uid()));

create function public.sync_focus_sessions(p_owner uuid,p_generation uuid,p_sessions jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_generation uuid; v_sessions jsonb;
begin
  if auth.uid() is null or p_owner is distinct from auth.uid() then raise exception 'Account changed' using errcode='42501'; end if;
  if jsonb_typeof(p_sessions) is distinct from 'array' or jsonb_array_length(p_sessions)>100 then raise exception 'Invalid session batch' using errcode='22023'; end if;
  insert into public.focus_history_heads(user_id) values(auth.uid()) on conflict do nothing;
  select generation into v_generation from public.focus_history_heads where user_id=auth.uid() for update;
  if (p_generation is null and jsonb_array_length(p_sessions)>0) or (p_generation is not null and p_generation<>v_generation) then
    raise exception 'History generation changed' using errcode='PT409';
  end if;
  if exists(select 1 from jsonb_array_elements(p_sessions) s where (s->>'completedAt')::timestamptz<'1970-01-01'::timestamptz or (s->>'completedAt')::timestamptz>now()+interval '5 minutes') then
    raise exception 'Invalid completion date' using errcode='22023';
  end if;
  insert into public.focus_sessions(user_id,id,generation,minutes,completed_at,room_id,room_name,topic,note)
  select auth.uid(),s->>'id',v_generation,(s->>'minutes')::integer,(s->>'completedAt')::timestamptz,s->>'roomId',s->>'roomName',s->>'topic',s->>'note'
  from jsonb_array_elements(p_sessions) s on conflict(user_id,id) do nothing;
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',id,'minutes',minutes,'completedAt',completed_at,'roomId',room_id,'roomName',room_name,'topic',topic,'note',note)) order by completed_at desc,id),'[]'::jsonb)
    into v_sessions from public.focus_sessions where user_id=auth.uid() and generation=v_generation;
  return jsonb_build_object('generation',v_generation,'sessions',v_sessions);
end;
$$;
create function public.reset_focus_history(p_owner uuid,p_expected_generation uuid)
returns uuid language plpgsql security invoker set search_path=public as $$
declare v_generation uuid; v_next uuid:=gen_random_uuid();
begin
  if auth.uid() is null or p_owner is distinct from auth.uid() then raise exception 'Account changed' using errcode='42501'; end if;
  select generation into v_generation from public.focus_history_heads where user_id=auth.uid() for update;
  if v_generation is null or p_expected_generation is distinct from v_generation then raise exception 'History generation changed' using errcode='PT409'; end if;
  delete from public.focus_sessions where user_id=auth.uid();
  update public.focus_history_heads set generation=v_next where user_id=auth.uid();
  return v_next;
end;
$$;
revoke all on function public.sync_focus_sessions(uuid,uuid,jsonb), public.reset_focus_history(uuid,uuid) from public,anon;
grant execute on function public.sync_focus_sessions(uuid,uuid,jsonb), public.reset_focus_history(uuid,uuid) to authenticated;
