-- Preserve revision history and OCC in one transaction after #150.
create or replace function public.save_learning_map_versioned(
  p_map jsonb, p_bibbles jsonb, p_edges jsonb, p_expected_version integer
) returns integer language plpgsql security invoker set search_path = public as $$
declare
  v_map_id text := p_map->>'id';
  v_version integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_map) is distinct from 'object'
     or jsonb_typeof(p_bibbles) is distinct from 'array'
     or jsonb_typeof(p_edges) is distinct from 'array'
     or coalesce(length(trim(v_map_id)), 0) = 0 then
    raise exception 'Invalid map payload' using errcode = '22023';
  end if;
  if p_expected_version is null then
    insert into public.learning_maps (id, user_id, title, description, category, accent, version)
    values (v_map_id, auth.uid(), p_map->>'title', coalesce(p_map->>'description',''),
      coalesce(p_map->>'category','Personal growth'), coalesce(p_map->>'accent','lavender'), 1)
    on conflict (id) do nothing returning version into v_version;
  else
    -- UPDATE locks the row and rechecks this predicate after any competing writer.
    update public.learning_maps set title = p_map->>'title',
      description = coalesce(p_map->>'description',''), category = coalesce(p_map->>'category','Personal growth'),
      accent = coalesce(p_map->>'accent','lavender'), version = version + 1
    where id = v_map_id and user_id = auth.uid() and version = p_expected_version
    returning version into v_version;
  end if;
  if v_version is null then
    raise exception 'CONCURRENCY_CONFLICT' using errcode = 'PT409';
  end if;
  delete from public.map_edges where map_id = v_map_id;
  delete from public.map_bibbles where map_id = v_map_id;
  insert into public.map_bibbles (id,map_id,title,description,status,progress,position_x,position_y,resources,notes)
  select b->>'id',v_map_id,b->>'title',coalesce(b->>'description',''),coalesce(b->>'status','not-started'),
    coalesce((b->>'progress')::integer,0),coalesce((b->>'position_x')::double precision,0),
    coalesce((b->>'position_y')::double precision,0),coalesce(b->'resources','[]'::jsonb),coalesce(b->>'notes','')
  from jsonb_array_elements(p_bibbles) b;
  insert into public.map_edges (id,map_id,source_id,target_id)
  select e->>'id',v_map_id,e->>'source_id',e->>'target_id' from jsonb_array_elements(p_edges) e;
  insert into public.learning_map_snapshots(id,map_id,user_id,revision,title,node_count,edge_count,snapshot_data,trigger)
  values ('occ_'||v_map_id||'_r'||v_version,v_map_id,auth.uid(),v_version,p_map->>'title',
    jsonb_array_length(p_bibbles),jsonb_array_length(p_edges),
    (select jsonb_build_object('id',m.id,'title',m.title,'description',m.description,'category',m.category,'accent',m.accent,'version',m.version,
      'bibbles',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'title',b.title,'description',b.description,'status',b.status,'progress',b.progress,'position',jsonb_build_object('x',b.position_x,'y',b.position_y),'resources',b.resources,'notes',b.notes) order by b.id),'[]'::jsonb) from public.map_bibbles b where b.map_id=v_map_id),
      'edges',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'source',e.source_id,'target',e.target_id) order by e.id),'[]'::jsonb) from public.map_edges e where e.map_id=v_map_id)) from public.learning_maps m where m.id=v_map_id),
    case when p_map->>'_snapshotTrigger'='restore' then 'restore' else 'save' end);
  return v_version;
end;
$$;

create or replace function public.restore_learning_map_versioned(p_map_id text,p_snapshot_id text,p_expected_version integer)
returns integer language plpgsql security invoker set search_path=public as $$
declare v_snapshot jsonb; v_bibbles jsonb; v_edges jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select snapshot_data into v_snapshot from public.learning_map_snapshots where id=p_snapshot_id and map_id=p_map_id and user_id=auth.uid();
  if v_snapshot is null then raise exception 'Snapshot not found' using errcode='42501'; end if;
  if p_expected_version is null then raise exception 'CONCURRENCY_CONFLICT' using errcode='PT409'; end if;
  select coalesce(jsonb_agg((b - 'position') || jsonb_build_object('position_x',b->'position'->'x','position_y',b->'position'->'y')),'[]'::jsonb) into v_bibbles from jsonb_array_elements(v_snapshot->'bibbles') b;
  select coalesce(jsonb_agg(jsonb_build_object('id',e->'id','source_id',e->'source','target_id',e->'target')),'[]'::jsonb) into v_edges from jsonb_array_elements(v_snapshot->'edges') e;
  return public.save_learning_map_versioned(v_snapshot || jsonb_build_object('id',p_map_id,'_snapshotTrigger','restore'),v_bibbles,v_edges,p_expected_version);
end;
$$;
revoke all on function public.restore_learning_map_versioned(text,text,integer) from public,anon;
grant execute on function public.restore_learning_map_versioned(text,text,integer) to authenticated;
