-- Atomic persistence for learning maps, bibbles, and edges.
-- Ensures that map updates, bibble synchronization, and edge updates
-- execute within a single atomic database transaction.
-- If any constraint or statement fails, the entire transaction rolls back,
-- preventing catastrophic partial deletion or orphaned states.

create or replace function public.save_learning_map_atomic(
  p_map jsonb,
  p_bibbles jsonb,
  p_edges jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_map_id text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_map) is distinct from 'object'
     or jsonb_typeof(p_bibbles) is distinct from 'array'
     or jsonb_typeof(p_edges) is distinct from 'array' then
    raise exception 'Map object, bibbles array, and edges array are required' using errcode = '22023';
  end if;
  v_map_id := p_map->>'id';

  if v_map_id is null or char_length(trim(v_map_id)) = 0 then
    raise exception 'Map ID is required';
  end if;

  -- 1. Upsert learning_maps record
  insert into public.learning_maps (id, user_id, title, description, category, accent)
  values (
    v_map_id,
    auth.uid(),
    coalesce(p_map->>'title', 'Untitled Map'),
    coalesce(p_map->>'description', ''),
    coalesce(p_map->>'category', 'Personal growth'),
    coalesce(p_map->>'accent', 'lavender')
  )
  on conflict (id) do update set
    title = excluded.title,
    description = excluded.description,
    category = excluded.category,
    accent = excluded.accent,
    updated_at = timezone('utc', now());

  -- 2. Clear previous edges and bibbles atomically within this transaction.
  -- Deleting edges first respects foreign key dependencies.
  delete from public.map_edges where map_id = v_map_id;
  delete from public.map_bibbles where map_id = v_map_id;

  -- 3. Insert updated bibbles if any
  if p_bibbles is not null and jsonb_typeof(p_bibbles) = 'array' and jsonb_array_length(p_bibbles) > 0 then
    insert into public.map_bibbles (
      id,
      map_id,
      title,
      description,
      status,
      progress,
      position_x,
      position_y,
      resources,
      notes
    )
    select
      b->>'id',
      v_map_id,
      b->>'title',
      coalesce(b->>'description', ''),
      coalesce(b->>'status', 'not-started'),
      coalesce((b->>'progress')::integer, 0),
      coalesce((b->>'position_x')::double precision, 0),
      coalesce((b->>'position_y')::double precision, 0),
      coalesce(b->'resources', '[]'::jsonb),
      coalesce(b->>'notes', '')
    from jsonb_array_elements(p_bibbles) as b;
  end if;

  -- 4. Insert updated edges if any
  if p_edges is not null and jsonb_typeof(p_edges) = 'array' and jsonb_array_length(p_edges) > 0 then
    insert into public.map_edges (
      id,
      map_id,
      source_id,
      target_id
    )
    select
      e->>'id',
      v_map_id,
      e->>'source_id',
      e->>'target_id'
    from jsonb_array_elements(p_edges) as e;
  end if;

  return true;
end;
$$;

revoke all on function public.save_learning_map_atomic(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_learning_map_atomic(jsonb, jsonb, jsonb) to authenticated;
