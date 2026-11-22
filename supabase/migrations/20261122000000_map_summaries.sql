-- Owner-scoped keyset pages. Only the selected page's nodes are aggregated.
create index if not exists learning_maps_owner_cursor_idx on public.learning_maps(user_id, updated_at desc, id desc);
create or replace function public.list_learning_map_summaries(
 p_search text default '', p_category text default null,
 p_cursor_time timestamptz default null, p_cursor_id text default null, p_limit integer default 25
) returns table(id text,title text,description text,category text,accent text,updated_at timestamptz,bibble_count bigint,progress integer)
language plpgsql stable security invoker set search_path = public as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_limit is null or p_limit < 1 or p_limit > 100 or length(coalesce(p_search,'')) > 200
    or ((p_cursor_time is null) <> (p_cursor_id is null)) then
   raise exception 'Invalid summary page request' using errcode='22023';
 end if;
 return query
 select m.id,m.title,m.description,m.category,m.accent,m.updated_at,
   totals.bibble_count,coalesce(round(totals.progress),0)::integer
 from (
   select lm.* from public.learning_maps lm
   where lm.user_id=auth.uid()
     and (p_category is null or lm.category=p_category)
     and (coalesce(p_search,'')='' or strpos(lower(lm.title || ' ' || lm.description),lower(p_search)) > 0)
     and (p_cursor_time is null or (lm.updated_at,lm.id)<(p_cursor_time,p_cursor_id))
   order by lm.updated_at desc,lm.id desc limit p_limit+1
 ) m
 cross join lateral (select count(*) as bibble_count,avg(b.progress) as progress from public.map_bibbles b where b.map_id=m.id) totals
 order by m.updated_at desc,m.id desc;
end;
$$;
revoke all on function public.list_learning_map_summaries(text,text,timestamptz,text,integer) from public,anon;
grant execute on function public.list_learning_map_summaries(text,text,timestamptz,text,integer) to authenticated;
