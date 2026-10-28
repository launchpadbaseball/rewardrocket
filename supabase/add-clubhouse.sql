-- ============================================================================
-- The Clubhouse — upgrade for the redesign
--
-- Only needed if you ran setup.sql BEFORE The Clubhouse redesign.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once. It ADDS things only: no points, prizes,
-- behaviors, journal entries or accounts are changed or deleted.
--
-- Adds: jersey number + position, "Pending Approval" check-ins from the
-- player dashboard, and career stats (lifetime XP for player levels).
-- ============================================================================

-- The Clubhouse: player card details, "Pending Approval" requests and stats.
alter table public.settings add column if not exists jersey_number text
  check (jersey_number ~ '^[0-9]{1,2}$');
alter table public.settings add column if not exists position text
  check (length(position) <= 12);

-- Jaylen can tap "I did it" on a lineup item; it waits here until a parent
-- approves it (which awards the XP) or declines it.
create table if not exists public.lineup_requests (
  id           uuid primary key default gen_random_uuid(),
  behavior_id  uuid not null references public.behaviors(id) on delete cascade,
  day          date not null,
  created_at   timestamptz not null default now(),
  unique (behavior_id, day)
);

alter table public.lineup_requests enable row level security;
drop policy if exists "parents all" on public.lineup_requests;
create policy "parents all" on public.lineup_requests for all to authenticated using (public.is_parent()) with check (public.is_parent());
grant select, insert, update, delete on public.lineup_requests to authenticated;

-- Career stats. Lifetime XP only counts XP earned, so redeeming a prize
-- never lowers his player level.
create or replace function public.player_stats_internal()
returns json
language sql stable security definer set search_path = public
as $$
  select json_build_object(
    'lifetime_xp',     coalesce((select sum(points) from public.ledger where points > 0 and kind <> 'redeem'), 0),
    'tasks_completed', (select count(*) from public.ledger where kind = 'earn'),
    'redeemed_count',  (select count(*) from public.ledger where kind = 'redeem'),
    'sports_count',    (select count(*) from public.ledger l join public.behaviors b on b.id = l.behavior_id
                        where l.kind = 'earn' and b.category = 'sports'),
    'journal_count',   (select count(*) from public.journal),
    'active_days',     coalesce((select json_agg(d order by d desc) from (
                          select distinct day as d from public.ledger
                          where points > 0 and kind <> 'redeem' and day > current_date - 400) x), '[]'::json)
  );
$$;
revoke execute on function public.player_stats_internal() from public, anon, authenticated;

-- The same stats for the parent app (parents only).
create or replace function public.player_stats()
returns json
language sql stable security definer set search_path = public
as $$
  select case when public.is_parent() then public.player_stats_internal() end;
$$;
revoke execute on function public.player_stats() from public, anon;
grant execute on function public.player_stats() to authenticated;

-- The player dashboard now also gets jersey, position, stats and pending check-ins.
create or replace function public.kid_dashboard(p_token uuid)
returns json
language sql stable security definer set search_path = public
as $$
  select case when s.kid_token is distinct from p_token then null else json_build_object(
    'kid_name',  s.kid_name,
    'avatar_url', s.avatar_url,
    'journal_points', s.journal_points,
    'jersey_number', s.jersey_number,
    'position',  s.position,
    'stats',     public.player_stats_internal(),
    'pending',   coalesce((select json_agg(json_build_object('behavior_id', q.behavior_id, 'day', q.day))
                  from public.lineup_requests q where q.day >= current_date - 1), '[]'::json),
    'balance',   (select coalesce(sum(points), 0) from public.ledger),
    'behaviors', coalesce((select json_agg(json_build_object(
                    'id', b.id, 'name', b.name, 'emoji', b.emoji,
                    'points', b.points, 'once_daily', b.once_daily,
                    'category', b.category
                  ) order by b.sort, b.created_at) from public.behaviors b), '[]'::json),
    'rewards',   coalesce((select json_agg(json_build_object(
                    'id', r.id, 'name', r.name, 'emoji', r.emoji,
                    'cost', r.cost, 'image_url', r.image_url
                  ) order by r.cost, r.sort) from public.rewards r), '[]'::json),
    'recent',    coalesce((select json_agg(x order by x.created_at desc) from (
                    select l.id, l.created_at, l.day, l.kind, l.points, l.reason, l.emoji, l.behavior_id
                    from public.ledger l
                    where l.created_at > now() - interval '15 days'
                    order by l.created_at desc
                    limit 300
                  ) x), '[]'::json),
    'journal',   coalesce((select json_agg(j order by j.day desc) from (
                    select id, day, mood, prompt, body, parent_reply, updated_at
                    from public.journal
                    order by day desc
                    limit 14
                  ) j), '[]'::json)
  ) end
  from public.settings s
  where s.id = 1;
$$;

grant execute on function public.kid_dashboard(uuid) to anon, authenticated;

-- Jaylen marks a lineup item as done from his dashboard. It does NOT award
-- XP: it only asks. A parent approves it (awarding the XP) or declines it.
create or replace function public.kid_request_task(p_token uuid, p_behavior_id uuid, p_day date)
returns boolean
language plpgsql volatile security definer set search_path = public
as $$
declare
  b public.behaviors;
begin
  if not exists (select 1 from public.settings where id = 1 and kid_token = p_token) then
    raise exception 'This link is old. Ask Mom or Dad for the new one.';
  end if;
  if p_day not between current_date - 1 and current_date + 1 then
    raise exception 'You can only check in for today.';
  end if;
  select * into b from public.behaviors where id = p_behavior_id;
  if not found then
    raise exception 'That item is no longer in the lineup.';
  end if;
  if b.once_daily and exists (select 1 from public.ledger
                              where behavior_id = b.id and day = p_day and kind = 'earn') then
    raise exception 'Already completed today.';
  end if;
  insert into public.lineup_requests (behavior_id, day) values (b.id, p_day)
  on conflict do nothing;
  return true;
end;
$$;

revoke execute on function public.kid_request_task(uuid, uuid, date) from public;
grant execute on function public.kid_request_task(uuid, uuid, date) to anon, authenticated;

-- Live updates: a check-in shows up on your phones right away.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lineup_requests') then
    alter publication supabase_realtime add table public.lineup_requests;
  end if;
end $$;
