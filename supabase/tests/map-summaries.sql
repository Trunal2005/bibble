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


\ir ../migrations/20261122000000_map_summaries.sql
insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into public.learning_maps(id,user_id,title,category,updated_at)
select 'm-'||lpad(i::text,3,'0'),'00000000-0000-0000-0000-000000000001','Map '||i,case when i=1 then 'Rare' else 'CS' end,'2026-11-22T00:00:00Z'::timestamptz from generate_series(1,60) i;
insert into public.learning_maps(id,user_id,title) values ('private-other','00000000-0000-0000-0000-000000000002','Secret');
insert into public.map_bibbles(id,map_id,title,progress,notes) values ('b1','m-060','Node',50,repeat('private note',1000)),('b2','m-060','Node 2',100,'');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$
declare first_ids text[]; second_ids text[];
begin
 select array_agg(id) into first_ids from public.list_learning_map_summaries('',null,null,null,25);
 if cardinality(first_ids)<>26 or first_ids[1]<>'m-060' then raise exception 'page bound/order'; end if;
 select array_agg(id) into second_ids from public.list_learning_map_summaries('',null,'2026-11-22T00:00:00Z','m-036',25);
 if second_ids[1]<>'m-035' or first_ids[1:25] && second_ids then raise exception 'cursor overlaps/skips'; end if;
 if (select count(*) from public.list_learning_map_summaries('Map 1','Rare',null,null,25))<>1 then raise exception 'search beyond first page'; end if;
 if (select progress from public.list_learning_map_summaries('',null,null,null,25) where id='m-060')<>75 then raise exception 'progress aggregate'; end if;
 if exists(select 1 from public.list_learning_map_summaries('Secret',null,null,null,25)) then raise exception 'cross-user leakage'; end if;
 if (select to_jsonb(s) ? 'notes' from public.list_learning_map_summaries('',null,null,null,25) s limit 1) then raise exception 'graph leaked'; end if;
 begin perform public.list_learning_map_summaries('',null,null,null,101); raise exception 'invalid page accepted'; exception when invalid_parameter_value then null; end;
 raise notice 'PASS: bounded pages, stable ties, search/category, progress and RLS';
end;
$$;
reset role;
set local role anon;
do $$ begin
 begin perform public.list_learning_map_summaries(); raise exception 'anonymous accepted'; exception when insufficient_privilege then null; end;
 raise notice 'PASS: anonymous summary access denied';
end $$;
rollback;
