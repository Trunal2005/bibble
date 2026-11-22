-- Run only against an EMPTY disposable PostgreSQL database:
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/atomic-map-persistence.sql
-- Supabase auth/storage stubs below provide identity and RLS, not hosted services.
\set ON_ERROR_STOP on
begin;
create role anon;
create role authenticated;
create schema auth;
create schema storage;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id text, bucket_id text, name text);
create function storage.foldername(text) returns text[] language sql immutable as
  $$ select string_to_array($1, '/') $$;
\ir ../migrations/20261026000000_learning_maps.sql
\ir ../migrations/20261120000000_atomic_map_persistence.sql


\ir ../migrations/20261122020000_focus_history.sql
insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$
declare owner_id uuid:=auth.uid(); generation uuid; next_generation uuid; response jsonb;
begin
 response:=public.sync_focus_sessions(owner_id,null,'[]');generation:=(response->>'generation')::uuid;
 response:=public.sync_focus_sessions(owner_id,generation,'[{"id":"one","minutes":25,"completedAt":"2026-11-22T00:00:00Z"}]');
 response:=public.sync_focus_sessions(owner_id,generation,'[{"id":"one","minutes":50,"completedAt":"2026-11-22T00:00:00Z"}]');
 if jsonb_array_length(response->'sessions')<>1 or (response->'sessions'->0->>'minutes')::integer<>25 then raise exception 'Idempotent insert failed'; end if;
 begin
  perform public.sync_focus_sessions(owner_id,generation,'[{"id":"two","minutes":30,"completedAt":"2026-11-22T00:00:00Z"},{"id":"invalid","minutes":-1,"completedAt":"2026-11-22T00:00:00Z"}]');
  raise exception 'Invalid duration accepted';
 exception when check_violation then null; end;
 if exists(select 1 from public.focus_sessions where id='two') then raise exception 'Partial batch committed'; end if;
 begin perform public.sync_focus_sessions('00000000-0000-0000-0000-000000000002',generation,'[]');raise exception 'Wrong account accepted';exception when insufficient_privilege then null;end;
 next_generation:=public.reset_focus_history(owner_id,generation);
 if exists(select 1 from public.focus_sessions) then raise exception 'Reset failed';end if;
 begin perform public.sync_focus_sessions(owner_id,generation,'[{"id":"stale","minutes":25,"completedAt":"2026-11-22T00:00:00Z"}]');raise exception 'Stale upload accepted';exception when sqlstate 'PT409' then null;end;
 begin perform public.reset_focus_history(owner_id,generation);raise exception 'Stale reset accepted';exception when sqlstate 'PT409' then null;end;
 perform public.sync_focus_sessions(owner_id,next_generation,'[{"id":"new","minutes":10,"completedAt":"2026-11-22T00:00:00Z"}]');
 raise notice 'PASS: idempotency, atomic rejection, identity and generation-checked reset';
end $$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
do $$ begin
 if exists(select 1 from public.focus_sessions) or exists(select 1 from public.focus_history_heads) then raise exception 'Cross-account RLS leak';end if;
 raise notice 'PASS: focus history and heads are isolated by owner';
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform public.sync_focus_sessions('00000000-0000-0000-0000-000000000001',null,'[]');raise exception 'Anonymous accepted';exception when insufficient_privilege then null;end;
 raise notice 'PASS: anonymous RPC access denied';
end $$;
rollback;
