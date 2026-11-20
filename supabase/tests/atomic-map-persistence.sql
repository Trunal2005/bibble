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

insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select public.save_learning_map_atomic(
  '{"id":"rollback-map","title":"Original"}',
  '[{"id":"a","title":"A","progress":50},{"id":"b","title":"B"}]',
  '[{"id":"a-b","source_id":"a","target_id":"b"}]');

do $$
begin
  begin
    perform public.save_learning_map_atomic('{"id":"rollback-map","title":"Changed"}',
      '[{"id":"a","title":"Bad","progress":101}]', '[]');
    raise exception 'Expected progress check violation';
  exception when check_violation then null;
  end;
  assert (select title = 'Original' from public.learning_maps where id = 'rollback-map');
  assert (select count(*) = 2 from public.map_bibbles where map_id = 'rollback-map');
  assert (select progress = 50 from public.map_bibbles where id = 'a');
  assert (select count(*) = 1 from public.map_edges where map_id = 'rollback-map');
  raise notice 'PASS: invalid bibble rolls back metadata, nodes, and edges';
  begin
    perform public.save_learning_map_atomic('{"id":"rollback-map","title":"Changed"}',
      '[{"id":"a","title":"A"}]', '[{"id":"bad","source_id":"a","target_id":"missing"}]');
    raise exception 'Expected foreign key violation';
  exception when foreign_key_violation then null;
  end;
  assert (select title = 'Original' from public.learning_maps where id = 'rollback-map');
  assert (select count(*) = 2 from public.map_bibbles where map_id = 'rollback-map');
  assert (select count(*) = 1 from public.map_edges where map_id = 'rollback-map');
  raise notice 'PASS: invalid edge rolls back the complete graph';
  begin
    perform public.save_learning_map_atomic('{"id":"rollback-map","title":"Changed"}', null, '[]');
    raise exception 'Expected invalid payload rejection';
  exception when invalid_parameter_value then null;
  end;
  assert (select count(*) = 2 from public.map_bibbles where map_id = 'rollback-map');
  raise notice 'PASS: malformed payload cannot erase graph';
end $$;

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$
begin
  assert (select count(*) = 0 from public.learning_maps);
  begin
    perform public.save_learning_map_atomic('{"id":"rollback-map","title":"Other user"}', '[]', '[]');
    raise exception 'Expected ownership rejection';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: RLS blocks cross-account reads and writes';
end $$;

reset role;
do $$
begin
  assert not has_function_privilege('anon', 'public.save_learning_map_atomic(jsonb,jsonb,jsonb)', 'execute');
  assert (select title = 'Original' from public.learning_maps where id = 'rollback-map');
  raise notice 'PASS: anonymous execution denied; original map preserved';
end $$;
rollback;
