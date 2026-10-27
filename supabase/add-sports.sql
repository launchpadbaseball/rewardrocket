-- ============================================================================
-- Reward Rocket 🚀 — add the Sports & Team section
--
-- Only needed if you ran setup.sql BEFORE the sports section existed.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once.
-- ============================================================================

alter table public.behaviors
  add column if not exists category text not null default 'home'
  check (category in ('home', 'sports'));

-- The original "Good sportsmanship" behavior moves into the sports section.
update public.behaviors set category = 'sports', sort = 101
where name = 'Good sportsmanship' and category = 'home';

-- Starter sports behaviors (skips any you already have by the same name).
insert into public.behaviors (name, emoji, points, once_daily, sort, category)
select v.*, 'sports' from (values
  ('Extra practice on his own',          '⚾', 3, true,  102),
  ('Being a great teammate',             '🙌', 3, false, 103),
  ('Full effort & hustle',               '💨', 3, false, 104),
  ('Listened to the coach',              '📣', 3, false, 105),
  ('Bounced back from a mistake',        '💪', 3, false, 106),
  ('Ready for practice on time',         '🧢', 2, true,  107),
  ('Respected umps, refs & opponents',   '👏', 3, false, 108)
) v(name, emoji, points, once_daily, sort)
where not exists (select 1 from public.behaviors b where lower(b.name) = lower(v.name));

-- Jaylen's dashboard now also gets each behavior's section.
create or replace function public.kid_dashboard(p_token uuid)
returns json
language sql stable security definer set search_path = public
as $$
  select case when s.kid_token is distinct from p_token then null else json_build_object(
    'kid_name',  s.kid_name,
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
                  ) x), '[]'::json)
  ) end
  from public.settings s
  where s.id = 1;
$$;

grant execute on function public.kid_dashboard(uuid) to anon, authenticated;
