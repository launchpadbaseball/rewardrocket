-- ============================================================================
-- Reward Rocket 🚀 — add a profile photo for the kid
--
-- Only needed if you ran setup.sql BEFORE profile photos existed.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once. Nothing else is changed.
-- ============================================================================

alter table public.settings add column if not exists avatar_url text;

-- Jaylen's dashboard now also gets the photo.
create or replace function public.kid_dashboard(p_token uuid)
returns json
language sql stable security definer set search_path = public
as $$
  select case when s.kid_token is distinct from p_token then null else json_build_object(
    'kid_name',  s.kid_name,
    'avatar_url', s.avatar_url,
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
