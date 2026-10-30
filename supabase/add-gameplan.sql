-- ============================================================================
-- The Clubhouse — Game Plan (standards instead of tasks)
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Needs add-notifications.sql to have been run first.
-- Safe to run more than once.
--
-- Replaces the old list of small tasks with 7 standards across At Home,
-- Learning and On the Field (edit them any time in the app). His XP,
-- levels, history, journal and prizes are NOT changed.
-- ============================================================================

-- 10. Game Plan: standards, not tasks ------------------------------------------
-- Three arenas (At Home, Learning, On the Field), each with a few standards
-- that describe how he shows up. Parents rate each standard once a day:
-- Solid / Strong / All-Star = 1x / 2x / 3x the standard's XP. Parents can
-- also recognize a standout moment with a note. Jaylen rates himself each
-- evening ("files his scouting report"); his rating sits next to yours, but
-- only yours awards XP.

do $$
begin
  if to_regclass('public.activity') is null then
    raise exception 'Run supabase/add-notifications.sql first, then run this file again.';
  end if;
end $$;

alter table public.behaviors add column if not exists description text not null default '';
alter table public.behaviors drop constraint if exists behaviors_category_check;
alter table public.behaviors add constraint behaviors_category_check
  check (category in ('home', 'learning', 'sports'));

alter table public.ledger add column if not exists level smallint check (level between 1 and 3);
alter table public.ledger drop constraint if exists ledger_kind_check;
alter table public.ledger add constraint ledger_kind_check
  check (kind in ('earn', 'adjust', 'redeem', 'journal', 'moment'));

alter table public.activity drop constraint if exists activity_kind_check;
alter table public.activity add constraint activity_kind_check
  check (kind in ('checkin', 'journal', 'report'));

-- His own rating of each standard, per day (0 = not today ... 3 = All-Star).
create table if not exists public.self_ratings (
  behavior_id  uuid not null references public.behaviors(id) on delete cascade,
  day          date not null,
  level        smallint not null check (level between 0 and 3),
  updated_at   timestamptz not null default now(),
  primary key (behavior_id, day)
);
alter table public.self_ratings enable row level security;
drop policy if exists "parents all" on public.self_ratings;
create policy "parents all" on public.self_ratings for all to authenticated using (public.is_parent()) with check (public.is_parent());
grant select, insert, update, delete on public.self_ratings to authenticated;

-- Jaylen files (or updates) his scouting report from his dashboard.
-- p_ratings: { "<standard id>": 0..3, ... }. Only touches his own ratings.
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
  if p_day not between current_date - 1 and current_date + 1 then
    raise exception 'You can only rate today.';
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
  select string_agg(b.name || ': ' || (array['Not today', 'Solid', 'Strong', 'All-Star'])[q.level + 1], ' · ' order by b.sort, b.created_at)
    into summary
    from public.self_ratings q join public.behaviors b on b.id = q.behavior_id where q.day = p_day;
  insert into public.activity (kind, title, body)
  values ('report', kid || case when existed then ' updated his scouting report' else ' filed his scouting report' end, left(summary, 600));

  return (select json_agg(json_build_object('behavior_id', behavior_id, 'day', day, 'level', level, 'updated_at', updated_at))
          from public.self_ratings where day = p_day);
end;
$$;
revoke execute on function public.kid_self_report(uuid, date, jsonb) from public;
grant execute on function public.kid_self_report(uuid, date, jsonb) to anon, authenticated;

-- Career stats, now with All-Star ratings and recognized moments.
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
    'allstar_count',   (select count(*) from public.ledger where kind = 'earn' and level = 3),
    'moment_count',    (select count(*) from public.ledger where kind = 'moment'),
    'active_days',     coalesce((select json_agg(d order by d desc) from (
                          select distinct day as d from public.ledger
                          where points > 0 and kind <> 'redeem' and day > current_date - 400) x), '[]'::json)
  );
$$;
revoke execute on function public.player_stats_internal() from public, anon, authenticated;

-- The player dashboard also gets each standard's description, his own
-- ratings, and the level of each rating.
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
    'self',      coalesce((select json_agg(json_build_object('behavior_id', q.behavior_id, 'day', q.day, 'level', q.level, 'updated_at', q.updated_at))
                  from public.self_ratings q where q.day >= current_date - 14), '[]'::json),
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

-- One email subject that fits any mix of updates.
create or replace function private.send_activity_email() returns void
language plpgsql security definer set search_path = public, private as $$
declare
  s        private.email_settings;
  recips   text[];
  kid      text;
  n_check  int;
  n_pg     int;
  subj     text;
  rows_html text;
  ids      uuid[];
  rid      bigint;
begin
  delete from public.activity where created_at < now() - interval '90 days';
  if not exists (select 1 from public.activity where emailed_at is null) then return; end if;
  if (select max(created_at) from public.activity where emailed_at is null) > now() - interval '45 seconds'
     and (select min(created_at) from public.activity where emailed_at is null) > now() - interval '10 minutes' then
    return;
  end if;

  select * into s from private.email_settings where id = 1;
  recips := array(select email from public.parents where notify_email order by email);
  if coalesce(s.api_key, '') = '' or cardinality(recips) = 0 then
    update public.activity set emailed_at = now() where emailed_at is null;   -- nothing to send; don't pile up
    return;
  end if;

  select coalesce(kid_name, 'Jaylen') into kid from public.settings where id = 1;
  select count(*) filter (where kind = 'checkin'), count(*) filter (where kind = 'journal'),
         string_agg(format('<tr><td style="padding:12px 0;border-bottom:1px solid #2b2f37">'
                    || '<div style="font:700 15px Arial,sans-serif;color:#f4f5f7">%s</div>'
                    || '<div style="font:14px Arial,sans-serif;color:#9aa1ac;margin-top:4px">%s</div></td></tr>',
                    private.esc(title), private.esc(body)), '' order by created_at),
         array_agg(id)
    into n_check, n_pg, rows_html, ids
    from public.activity where emailed_at is null;

  subj := case
    when cardinality(ids) = 1 then (select title from public.activity where id = ids[1])
    else cardinality(ids) || ' new updates from ' || kid
  end;

  select net.http_post(
    url := s.api_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || s.api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object('from', s.from_address, 'to', to_jsonb(recips), 'subject', subj, 'html',
      format('<div style="background:#0a0b0d;padding:24px"><div style="max-width:520px;margin:0 auto;background:#16181c;border:1px solid #2b2f37;border-radius:16px;padding:20px">'
        || '<div style="font:800 18px Arial,sans-serif;letter-spacing:3px;color:#f6c90e">THE CLUBHOUSE</div>'
        || '<table style="width:100%%;border-collapse:collapse;margin:10px 0 18px">%s</table>'
        || '<a href="%s" style="display:inline-block;background:#f6c90e;color:#1a1400;font:800 14px Arial,sans-serif;padding:12px 18px;border-radius:10px;text-decoration:none">Open The Clubhouse</a>'
        || '<div style="font:12px Arial,sans-serif;color:#6b717c;margin-top:16px">Turn these emails off in the app: gear icon → Notifications.</div></div></div>',
        rows_html, private.esc(s.app_url)))
  ) into rid;
  insert into private.email_log (request_id, kind) values (rid, 'activity');
  update public.activity set emailed_at = now() where id = any(ids);
end;
$$;


-- Live updates: his report shows up on your phones right away.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'self_ratings') then
    alter publication supabase_realtime add table public.self_ratings;
  end if;
end $$;

-- Swap the old task list for the Game Plan standards (once). XP he already
-- earned, his levels, history and prizes are untouched.
do $$
begin
  if not exists (select 1 from public.behaviors where category = 'learning') then
    delete from public.behaviors;
    insert into public.behaviors (name, emoji, points, once_daily, sort, category, description) values
      ('Own Your Responsibilities', '🏠', 2, true, 1, 'home',
       'Ready on time, chores done, room and gear taken care of, bedtime routine. All without reminders.'),
      ('Respect & Kindness', '🤝', 2, true, 2, 'home',
       'Listens the first time, speaks respectfully, is kind to family, and stays calm when frustrated.'),
      ('Homework & Study Habits', '📚', 2, true, 3, 'learning',
       'Starts homework without being asked, finishes it, checks his work, and reads every day.'),
      ('Learner''s Mindset', '🧠', 2, true, 4, 'learning',
       'Gives full effort on hard problems, asks for help, owns his grades and teacher feedback, keeps growing.'),
      ('Compete Every Rep', '⚾', 2, true, 5, 'sports',
       'Full effort and hustle, ready on time, and extra practice on his own.'),
      ('Great Teammate', '🙌', 2, true, 6, 'sports',
       'Encourages others, shows good sportsmanship, respects coaches, umps and opponents.'),
      ('Coachable', '📣', 2, true, 7, 'sports',
       'Listens to coaches, takes feedback, and bounces back from mistakes.');
  end if;
end $$;
