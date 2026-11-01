-- ============================================================================
-- The Clubhouse — let parents rate a standard "Not today"
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once. Nothing you already have is changed.
-- ============================================================================

-- 11. "Not today" is a rating too ------------------------------------------------
-- A parent can mark a standard "Not today": it counts as rated for the day,
-- with 0 XP. Stored as a 0-point rating (level 0); everything else still
-- needs non-zero points.

alter table public.ledger drop constraint if exists ledger_points_check;
alter table public.ledger add constraint ledger_points_check
  check (points <> 0 or (kind = 'earn' and level = 0));
alter table public.ledger drop constraint if exists ledger_level_check;
alter table public.ledger add constraint ledger_level_check
  check (level between 0 and 3);

-- Career stats only count ratings that earned XP.
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
    'moment_count',    (select count(*) from public.ledger where kind = 'moment'),
    'active_days',     coalesce((select json_agg(d order by d desc) from (
                          select distinct day as d from public.ledger
                          where points > 0 and kind <> 'redeem' and day > current_date - 400) x), '[]'::json)
  );
$$;
revoke execute on function public.player_stats_internal() from public, anon, authenticated;
