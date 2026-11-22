-- EMPTY disposable database only. All test setup is rolled back.
\set ON_ERROR_STOP on
begin;
\ir bootstrap.sql
insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');

\ir ../migrations/20261121000000_map_versions.sql

\ir ../migrations/20261122000000_map_revision_history.sql
\ir ../migrations/20261122030000_versioned_history_integration.sql
create function public.reject_test_snapshot() returns trigger language plpgsql as $$ begin
 if new.title='Force snapshot failure' then raise exception 'snapshot write failed'; end if; return new;
end $$;
create trigger test_snapshot_failure before insert on public.learning_map_snapshots for each row execute function public.reject_test_snapshot();
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$
declare v integer; i integer;
begin
 v:=public.save_learning_map_versioned('{"id":"history-map","title":"Original"}',
 '[{"id":"a","title":"A","notes":"original note","progress":50},{"id":"b","title":"B"}]',
 '[{"id":"a-b","source_id":"a","target_id":"b"}]',null);
 assert v=1;
 assert (select count(*)=1 from public.learning_map_snapshots where map_id='history-map');
 assert (select snapshot_data->'bibbles'->0->'position'->>'x'='0' from public.learning_map_snapshots where id='occ_history-map_r1');
 v:=public.save_learning_map_versioned('{"id":"history-map","title":"Second"}','[]','[]',1);
 assert v=2;
 v:=public.restore_learning_map_versioned('history-map','occ_history-map_r1',2);
 assert v=3;
 assert (select title='Original' and version=3 from public.learning_maps where id='history-map');
 assert (select count(*)=2 from public.map_bibbles where map_id='history-map');
 assert (select count(*)=1 from public.map_edges where map_id='history-map');
 assert (select trigger='restore' and snapshot_data->>'version'='3' from public.learning_map_snapshots where id='occ_history-map_r3');
 begin
  perform public.restore_learning_map_versioned('history-map','occ_history-map_r1',2);
  raise exception 'Stale restore succeeded';
 exception when sqlstate 'PT409' then null;end;
 assert (select count(*)=3 from public.learning_map_snapshots where map_id='history-map');
 begin
  perform public.save_learning_map_versioned('{"id":"history-map","title":"Force snapshot failure"}','[]','[]',3);
  raise exception 'Failed snapshot did not abort';
 exception when raise_exception then if sqlerrm<>'snapshot write failed' then raise;end if;end;
 assert (select title='Original' and version=3 from public.learning_maps where id='history-map');
 assert (select count(*)=2 from public.map_bibbles where map_id='history-map');
 assert (select count(*)=3 from public.learning_map_snapshots where map_id='history-map');
 for i in 4..25 loop
  perform public.save_learning_map_versioned('{"id":"history-map","title":"Retained"}','[]','[]',i-1);
 end loop;
 assert (select count(*)=20 and min(revision)=6 and max(revision)=25 from public.learning_map_snapshots where map_id='history-map');
 raise notice 'PASS: atomic snapshots/restore, stale rejection, rollback, and retention';
end $$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
do $$ begin
 assert (select count(*)=0 from public.learning_map_snapshots where map_id='history-map');
 begin perform public.restore_learning_map_versioned('history-map','occ_history-map_r25',25);
 raise exception 'Foreign restore accepted';exception when insufficient_privilege then null;end;
 raise notice 'PASS: foreign history/restore denied';
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform public.restore_learning_map_versioned('history-map','occ_history-map_r25',25);
 raise exception 'Anonymous restore accepted';exception when insufficient_privilege then null;end;
 raise notice 'PASS: anonymous restore denied';
end $$;
rollback;
