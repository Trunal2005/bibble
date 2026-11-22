-- Durable map revision snapshots for learning maps.
-- Snapshots are immutable, owned by the map creator, and protected by RLS.

create table if not exists public.learning_map_snapshots (
  id text primary key,
  map_id text not null references public.learning_maps(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  revision integer not null default 1 check (revision > 0),
  title text not null check (char_length(title) between 1 and 200),
  node_count integer not null default 0 check (node_count >= 0),
  edge_count integer not null default 0 check (edge_count >= 0),
  snapshot_data jsonb not null,
  trigger text not null default 'save' check (trigger in ('save', 'restore', 'initial')),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists learning_map_snapshots_map_rev_idx
  on public.learning_map_snapshots(map_id, revision desc);

create index if not exists learning_map_snapshots_user_idx
  on public.learning_map_snapshots(user_id, created_at desc);

-- RLS permissions
revoke all on public.learning_map_snapshots from anon;
grant select, insert, delete on public.learning_map_snapshots to authenticated;

alter table public.learning_map_snapshots enable row level security;

drop policy if exists "Users can manage their map snapshots" on public.learning_map_snapshots;
create policy "Users can manage their map snapshots" on public.learning_map_snapshots
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.learning_maps m
      where m.id = learning_map_snapshots.map_id
      and m.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.learning_maps m
      where m.id = learning_map_snapshots.map_id
      and m.user_id = (select auth.uid())
    )
  );

-- Retention trigger: Automatically keep up to 20 latest snapshots per map
create or replace function public.prune_old_learning_map_snapshots()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_max_snapshots constant integer := 20;
begin
  delete from public.learning_map_snapshots
  where map_id = new.map_id
    and id not in (
      select id from public.learning_map_snapshots
      where map_id = new.map_id
      order by revision desc, created_at desc
      limit v_max_snapshots
    );
  return new;
end;
$$;

drop trigger if exists trigger_prune_learning_map_snapshots on public.learning_map_snapshots;
create trigger trigger_prune_learning_map_snapshots
  after insert on public.learning_map_snapshots
  for each row execute function public.prune_old_learning_map_snapshots();
