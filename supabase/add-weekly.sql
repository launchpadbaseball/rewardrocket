-- ============================================================================
-- The Clubhouse — weekly points (Sunday review) and shout-outs
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once. His XP, levels, history and prizes are not
-- changed. On the first run it sets each standard from +2 to +5 XP per
-- level (now per week) and turns off XP for the daily question.
-- ============================================================================

-- 12. Weekly points ----------------------------------------------------------------
-- XP now comes once a week. The week runs Monday to Sunday; on Sunday the
-- parents review the week and rate each standard (Solid / Strong / All-Star
-- = 1x / 2x / 3x its XP), stored as one rating per standard per week on
-- that week's Sunday. Jaylen files a weekly scouting report before the
-- review. During the week parents can give shout-outs (no XP) any time,
-- and the daily question earns no XP on its own.

-- Shout-outs: recognition any time, no XP.
create table if not exists public.shoutouts (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  day          date not null,
  behavior_id  uuid references public.behaviors(id) on delete set null,
  note         text not null check (length(note) between 1 and 200),
  created_by   text default (auth.jwt() ->> 'email')
);
create index if not exists shoutouts_created_idx on public.shoutouts (created_at desc);

do $$
begin
  -- First run only: switch the standards' XP from per-day to per-week and
  -- stop paying XP for the daily question (parents can change both later).
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'shoutouts_setup_done') then
    update public.behaviors set points = 5 where points = 2;
    update public.settings set journal_points = 0;
    create table public.shoutouts_setup_done ();
    revoke all on public.shoutouts_setup_done from anon, authenticated;
  end if;
end $$;

alter table public.shoutouts enable row level security;
drop policy if exists "parents all" on public.shoutouts;
create policy "parents all" on public.shoutouts for all to authenticated using (public.is_parent()) with check (public.is_parent());
grant select, insert, update, delete on public.shoutouts to authenticated;

-- His weekly scouting report (rated for the week ending on p_day, a Sunday).
create or replace function public.kid_self_report(p_token uuid, p_day date, p_ratings jsonb)
returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  kid      text;
  n        int;
  existed  boolean;
  summary  text;
begin
  if not exists (select 1 from public.settings where id = 1 and kid_token = p_token) then
    raise exception 'This link is old. Ask Mom or Dad for the new one.';
  end if;
  -- p_day is the Sunday that ends the week he's rating.
  if p_day not between current_date - 3 and current_date + 7 then
    raise exception 'You can only rate this week.';
  end if;
  existed := exists (select 1 from public.self_ratings where day = p_day);

  insert into public.self_ratings (behavior_id, day, level, updated_at)
  select b.id, p_day, (r.value #>> '{}')::smallint, now()
  from jsonb_each(p_ratings) r
  join public.behaviors b on b.id::text = r.key
  where (r.value #>> '{}') ~ '^[0-3]$'
  on conflict (behavior_id, day) do update set level = excluded.level, updated_at = now();
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Rate at least one standard first.'; end if;

  select coalesce(kid_name, 'Jaylen') into kid from public.settings where id = 1;
  select string_agg(b.name || ': ' || (array['Not this week', 'Solid', 'Strong', 'All-Star'])[q.level + 1], ' · ' order by b.sort, b.created_at)
    into summary
    from public.self_ratings q join public.behaviors b on b.id = q.behavior_id where q.day = p_day;
  insert into public.activity (kind, title, body)
  values ('report', kid || case when existed then ' updated his weekly scouting report' else ' filed his weekly scouting report' end, left(summary, 600));

  return (select json_agg(json_build_object('behavior_id', behavior_id, 'day', day, 'level', level, 'updated_at', updated_at))
          from public.self_ratings where day = p_day);
end;
$$;
revoke execute on function public.kid_self_report(uuid, date, jsonb) from public;
grant execute on function public.kid_self_report(uuid, date, jsonb) to anon, authenticated;

-- Stats: streaks count days he answered his daily question; shout-outs
-- count toward Highlight Reel.
create or replace function public.player_stats_internal()
returns json
language sql stable security definer set search_path = public
as $$
  select json_build_object(
    'lifetime_xp',     coalesce((select sum(points) from public.ledger where points > 0 and kind <> 'redeem'), 0),
    'tasks_completed', (select count(*) from public.ledger where kind = 'earn' and points > 0),
    'redeemed_count',  (select count(*) from public.ledger where kind = 'redeem'),
    'sports_count',    (select count(*) from public.ledger l join public.behaviors b on b.id = l.behavior_id
                        where l.kind = 'earn' and l.points > 0 and b.category = 'sports'),
    'journal_count',   (select count(*) from public.journal),
    'allstar_count',   (select count(*) from public.ledger where kind = 'earn' and level = 3),
    'moment_count',    (select count(*) from public.ledger where kind = 'moment') + (select count(*) from public.shoutouts),
    'active_days',     coalesce((select json_agg(d order by d desc) from (
                          select distinct day as d from public.journal where day > current_date - 400) x), '[]'::json)
  );
$$;
revoke execute on function public.player_stats_internal() from public, anon, authenticated;

-- The player dashboard also gets this month's shout-outs.
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
    'shoutouts', coalesce((select json_agg(json_build_object('id', o.id, 'created_at', o.created_at, 'day', o.day,
                    'behavior_id', o.behavior_id, 'note', o.note) order by o.created_at desc)
                  from public.shoutouts o where o.created_at > now() - interval '21 days'), '[]'::json),
    'self',      coalesce((select json_agg(json_build_object('behavior_id', q.behavior_id, 'day', q.day, 'level', q.level, 'updated_at', q.updated_at))
                  from public.self_ratings q where q.day >= current_date - 21), '[]'::json),
    'pending',   coalesce((select json_agg(json_build_object('behavior_id', q.behavior_id, 'day', q.day))
                  from public.lineup_requests q where q.day >= current_date - 1), '[]'::json),
    'balance',   (select coalesce(sum(points), 0) from public.ledger),
    'behaviors', coalesce((select json_agg(json_build_object(
                    'id', b.id, 'name', b.name, 'emoji', b.emoji,
                    'points', b.points, 'once_daily', b.once_daily,
                    'category', b.category, 'description', b.description
                  ) order by b.sort, b.created_at) from public.behaviors b), '[]'::json),
    'rewards',   coalesce((select json_agg(json_build_object(
                    'id', r.id, 'name', r.name, 'emoji', r.emoji,
                    'cost', r.cost, 'image_url', r.image_url
                  ) order by r.cost, r.sort) from public.rewards r), '[]'::json),
    'recent',    coalesce((select json_agg(x order by x.created_at desc) from (
                    select l.id, l.created_at, l.day, l.kind, l.points, l.reason, l.emoji, l.behavior_id, l.level
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

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shoutouts') then
    alter publication supabase_realtime add table public.shoutouts;
  end if;
end $$;
