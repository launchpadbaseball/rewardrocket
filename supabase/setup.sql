-- ============================================================================
-- The Clubhouse — database setup
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It is safe to run more than once.
--
-- BEFORE RUNNING: change the two parent emails in section 1 to the emails you
-- and your wife will log in with. Only emails on that list can see or change
-- anything, even if someone else manages to create an account.
-- ============================================================================


-- 1. Parents allowed to use the app -------------------------------------------

create table if not exists public.parents (
  email text primary key
);

insert into public.parents (email) values
  ('dad@example.com'),     -- ← change me
  ('mom@example.com')      -- ← change me
on conflict do nothing;

-- True when the logged-in user's email is on the parents list.
create or replace function public.is_parent()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.parents
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

grant execute on function public.is_parent() to authenticated;


-- 2. Tables ------------------------------------------------------------------

-- One row: the kid's name and the secret that unlocks the kid dashboard link.
create table if not exists public.settings (
  id         int primary key default 1 check (id = 1),
  kid_name   text not null default 'Jaylen',
  avatar_url text,
  kid_token  uuid not null default gen_random_uuid()
);
insert into public.settings (id) values (1) on conflict do nothing;
-- (For databases created before profile photos existed.)
alter table public.settings add column if not exists avatar_url text;

create table if not exists public.behaviors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  emoji       text not null default '⭐',
  points      int  not null check (points > 0),
  once_daily  boolean not null default true,   -- can only be earned once per day
  category    text not null default 'home' check (category in ('home', 'sports')),
  sort        int  not null default 0,
  created_at  timestamptz not null default now()
);

-- (For databases created before the sports section existed.)
alter table public.behaviors add column if not exists category text not null default 'home'
  check (category in ('home', 'sports'));

create table if not exists public.rewards (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  emoji       text not null default '🎁',
  cost        int  not null check (cost > 0),
  image_url   text,
  sort        int  not null default 0,
  created_at  timestamptz not null default now()
);

-- Every point change ever made. The balance is the sum of `points`.
--   earn   — a behavior was awarded (positive)
--   adjust — a manual bonus or deduction by a parent (positive or negative)
--   redeem — a prize was bought (negative)
create table if not exists public.ledger (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  day          date not null,                     -- the family's local date
  kind         text not null check (kind in ('earn', 'adjust', 'redeem', 'journal')),
  points       int  not null check (points <> 0),
  reason       text not null,
  emoji        text,
  behavior_id  uuid references public.behaviors(id) on delete set null,
  reward_id    uuid references public.rewards(id)   on delete set null,
  once_daily   boolean not null default false,    -- copied from the behavior
  created_by   text default (auth.jwt() ->> 'email')
);

create index if not exists ledger_created_at_idx on public.ledger (created_at desc);

-- The duplicate guard: a once-a-day behavior can only be earned once per day,
-- even if both parents tap it at the same moment on two phones.
create unique index if not exists ledger_once_daily_uniq
  on public.ledger (behavior_id, day)
  where kind = 'earn' and once_daily;


-- 3. Security: only parents can read or write ---------------------------------

alter table public.parents   enable row level security;
alter table public.settings  enable row level security;
alter table public.behaviors enable row level security;
alter table public.rewards   enable row level security;
alter table public.ledger    enable row level security;

drop policy if exists "parents read" on public.parents;
create policy "parents read" on public.parents for select to authenticated using (public.is_parent());

drop policy if exists "parents all" on public.settings;
create policy "parents all" on public.settings  for all to authenticated using (public.is_parent()) with check (public.is_parent());
drop policy if exists "parents all" on public.behaviors;
create policy "parents all" on public.behaviors for all to authenticated using (public.is_parent()) with check (public.is_parent());
drop policy if exists "parents all" on public.rewards;
create policy "parents all" on public.rewards   for all to authenticated using (public.is_parent()) with check (public.is_parent());
drop policy if exists "parents all" on public.ledger;
create policy "parents all" on public.ledger    for all to authenticated using (public.is_parent()) with check (public.is_parent());

grant select on public.parents to authenticated;
grant select, insert, update, delete on public.settings, public.behaviors, public.rewards, public.ledger to authenticated;


-- Jaylen's journal: one entry per day (how he feels + a few words), which
-- he writes from his dashboard. Parents can read it and write back.
-- Writing in it earns points (settings.journal_points, 0 turns that off),
-- recorded in the ledger as kind 'journal', at most once a day.
alter table public.settings add column if not exists journal_points int not null default 2
  check (journal_points between 0 and 50);
alter table public.ledger drop constraint if exists ledger_kind_check;
alter table public.ledger add constraint ledger_kind_check
  check (kind in ('earn', 'adjust', 'redeem', 'journal'));
create unique index if not exists ledger_journal_once_a_day
  on public.ledger (day) where kind = 'journal';

create table if not exists public.journal (
  id            uuid primary key default gen_random_uuid(),
  day           date not null unique,
  mood          text not null check (mood in ('awesome', 'good', 'okay', 'sad', 'frustrated', 'worried')),
  prompt        text check (length(prompt) <= 200),
  body          text not null default '' check (length(body) <= 1000),
  parent_reply  text check (length(parent_reply) <= 500),
  replied_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.journal enable row level security;
drop policy if exists "parents all" on public.journal;
create policy "parents all" on public.journal for all to authenticated using (public.is_parent()) with check (public.is_parent());
grant select, insert, update, delete on public.journal to authenticated;

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

-- Current point balance (0 for anyone who isn't a parent).
create or replace function public.balance()
returns int
language sql stable security invoker set search_path = public
as $$
  select coalesce(sum(points), 0)::int from public.ledger;
$$;

grant execute on function public.balance() to authenticated;


-- 4. Redeeming a prize --------------------------------------------------------
-- Done in the database so the balance check and the deduction happen together:
-- two parents redeeming at once can never take the balance below zero.

create or replace function public.redeem_reward(p_reward_id uuid, p_day date)
returns public.ledger
language plpgsql security invoker set search_path = public
as $$
declare
  r       public.rewards;
  balance int;
  row     public.ledger;
begin
  if not public.is_parent() then
    raise exception 'Only parents can redeem prizes';
  end if;

  -- One redemption at a time.
  perform pg_advisory_xact_lock(hashtext('reward-rocket-ledger'));

  select * into r from public.rewards where id = p_reward_id;
  if not found then
    raise exception 'That prize no longer exists';
  end if;

  select coalesce(sum(points), 0) into balance from public.ledger;
  if balance < r.cost then
    raise exception 'Not enough points yet (has %, needs %)', balance, r.cost;
  end if;

  insert into public.ledger (day, kind, points, reason, emoji, reward_id)
  values (p_day, 'redeem', -r.cost, r.name, r.emoji, r.id)
  returning * into row;
  return row;
end;
$$;

grant execute on function public.redeem_reward(uuid, date) to authenticated;


-- 5. The kid dashboard --------------------------------------------------------
-- Jaylen's page has no login. It calls this function with the secret from his
-- link and gets back a read-only snapshot. Without the right secret it gets
-- nothing. Parents can change the secret (Setup tab) to cut off an old link.

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

-- Jaylen saves today's journal entry from his dashboard. Like the dashboard
-- itself it needs the secret from his link, and it can ONLY write his own
-- journal entry for today (or yesterday/tomorrow, to allow for time zones):
-- it can't touch points, prizes or anything else. Saving again the same day
-- updates that day's entry and keeps any reply from Mom or Dad.
-- The first time each day he saves an answer with some writing in it, he
-- earns settings.journal_points (the unique index makes that once a day).
create or replace function public.kid_save_journal(p_token uuid, p_day date, p_mood text, p_prompt text, p_body text)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  j       public.journal;
  pts     int;
  awarded int := 0;
begin
  if not exists (select 1 from public.settings where id = 1 and kid_token = p_token) then
    raise exception 'This link is old. Ask Mom or Dad for the new one.';
  end if;
  if p_day not between current_date - 1 and current_date + 1 then
    raise exception 'You can only write about today.';
  end if;

  insert into public.journal (day, mood, prompt, body)
  values (p_day, p_mood, left(p_prompt, 200), left(coalesce(p_body, ''), 1000))
  on conflict (day) do update
    set mood = excluded.mood, prompt = excluded.prompt, body = excluded.body, updated_at = now()
  returning * into j;

  select journal_points into pts from public.settings where id = 1;
  if length(trim(j.body)) > 0 and pts > 0 then
    insert into public.ledger (day, kind, points, reason, emoji, created_by)
    values (p_day, 'journal', pts, 'Wrote in My Day', '📝', null)
    on conflict do nothing;
    get diagnostics awarded = row_count;
  end if;

  return json_build_object('id', j.id, 'day', j.day, 'mood', j.mood, 'prompt', j.prompt,
                           'body', j.body, 'parent_reply', j.parent_reply, 'updated_at', j.updated_at,
                           'points_awarded', case when awarded > 0 then pts else 0 end);
end;
$$;

revoke execute on function public.kid_save_journal(uuid, date, text, text, text) from public;
grant execute on function public.kid_save_journal(uuid, date, text, text, text) to anon, authenticated;

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


-- 6. Live updates between the two phones --------------------------------------

do $$
declare t text;
begin
  foreach t in array array['ledger', 'behaviors', 'rewards', 'settings', 'journal', 'lineup_requests'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;


-- 7. Prize pictures -----------------------------------------------------------
-- A public bucket: anyone with a picture's exact link can view it (so the kid
-- page can show it), but only parents can upload, replace or delete.

insert into storage.buckets (id, name, public)
values ('reward-images', 'reward-images', true)
on conflict (id) do nothing;

drop policy if exists "parents upload reward images" on storage.objects;
create policy "parents upload reward images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'reward-images' and public.is_parent());

drop policy if exists "parents update reward images" on storage.objects;
create policy "parents update reward images" on storage.objects
  for update to authenticated
  using (bucket_id = 'reward-images' and public.is_parent());

drop policy if exists "parents delete reward images" on storage.objects;
create policy "parents delete reward images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'reward-images' and public.is_parent());


-- 8. Starter behaviors and prizes (only added if the lists are empty) ---------

insert into public.behaviors (name, emoji, points, once_daily, sort)
select * from (values
  ('Ready for school without reminders', '🎒', 2, true,  1),
  ('Completed homework',                 '📚', 3, true,  2),
  ('Listened & followed directions',     '👂', 3, false, 3),
  ('Being respectful',                   '🤝', 3, false, 4),
  ('Completed chores',                   '🧹', 3, true,  5),
  ('Showing kindness',                   '💛', 3, false, 6),
  ('Handled frustration well',           '🧘', 3, false, 7),
  ('Bedtime routine',                    '🌙', 2, true,  8),
  ('Good behavior at school',            '🏫', 4, true,  9)
) v(name, emoji, points, once_daily, sort)
where not exists (select 1 from public.behaviors);

-- Sports & Team: his approach to the game, not how well he played.
insert into public.behaviors (name, emoji, points, once_daily, sort, category)
select v.*, 'sports' from (values
  ('Good sportsmanship',                 '🏆', 5, false, 101),
  ('Extra practice on his own',          '⚾', 3, true,  102),
  ('Being a great teammate',             '🙌', 3, false, 103),
  ('Full effort & hustle',               '💨', 3, false, 104),
  ('Listened to the coach',              '📣', 3, false, 105),
  ('Bounced back from a mistake',        '💪', 3, false, 106),
  ('Ready for practice on time',         '🧢', 2, true,  107),
  ('Respected umps, refs & opponents',   '👏', 3, false, 108)
) v(name, emoji, points, once_daily, sort)
where not exists (select 1 from public.behaviors where category = 'sports');

insert into public.rewards (name, emoji, cost, sort)
select * from (values
  ('Small Squishy',   '🧸', 30, 1),
  ('Regular NeeDoh',  '🟣', 50, 2),
  ('Special NeeDoh',  '🌈', 100, 3)
) v(name, emoji, cost, sort)
where not exists (select 1 from public.rewards);


-- 9. Notifications ------------------------------------------------------------
-- When Jaylen checks in a lineup item or answers his postgame interview, an
-- activity row is recorded. The parent app shows these live (bell + pop-up),
-- and once a minute any new ones are emailed to the parents who want email,
-- bundled into one message, through Resend (https://resend.com).

create extension if not exists pg_net;
create extension if not exists pg_cron;

alter table public.parents add column if not exists notify_email boolean not null default true;

create table if not exists public.activity (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  kind        text not null check (kind in ('checkin', 'journal')),
  title       text not null,
  body        text not null default '',
  emailed_at  timestamptz
);
create index if not exists activity_created_idx on public.activity (created_at desc);

alter table public.activity enable row level security;
drop policy if exists "parents read" on public.activity;
create policy "parents read" on public.activity for select to authenticated using (public.is_parent());
grant select on public.activity to authenticated;

-- Private settings: not reachable from the website at all.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.email_settings (
  id            int primary key default 1 check (id = 1),
  api_key       text,                                                -- your Resend API key
  from_address  text not null default 'The Clubhouse <onboarding@resend.dev>',
  app_url       text not null default 'https://rewardrocket.netlify.app/',
  api_url       text not null default 'https://api.resend.com/emails'
);
insert into private.email_settings (id) values (1) on conflict do nothing;

create table if not exists private.email_log (
  request_id  bigint primary key,
  created_at  timestamptz not null default now(),
  kind        text not null
);

create or replace function private.esc(t text) returns text
language sql immutable as $$
  select replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
$$;

-- Record a check-in.
create or replace function private.on_checkin() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  b   public.behaviors;
  kid text;
begin
  select * into b from public.behaviors where id = new.behavior_id;
  select kid_name into kid from public.settings where id = 1;
  insert into public.activity (kind, title, body)
  values ('checkin', coalesce(kid, 'Jaylen') || ' checked in: ' || coalesce(b.name, 'a lineup item'),
          '+' || coalesce(b.points, 0) || ' XP · waiting for your approval');
  return new;
end;
$$;
drop trigger if exists lineup_requests_activity on public.lineup_requests;
create trigger lineup_requests_activity after insert on public.lineup_requests
  for each row execute function private.on_checkin();

-- Record a postgame answer (not a parent's reply).
create or replace function private.on_journal() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  kid   text;
  moods jsonb := '{"awesome":"fired up","good":"good","okay":"okay","sad":"down","frustrated":"frustrated","worried":"worried"}';
begin
  if tg_op = 'UPDATE' and old.mood is not distinct from new.mood and old.body is not distinct from new.body then
    return new;
  end if;
  select kid_name into kid from public.settings where id = 1;
  insert into public.activity (kind, title, body)
  values ('journal',
          coalesce(kid, 'Jaylen') || case when tg_op = 'INSERT' then ' answered his postgame interview' else ' updated his postgame answer' end,
          'Feeling ' || coalesce(moods ->> new.mood, new.mood)
            || case when coalesce(new.body, '') <> '' then ': “' || left(new.body, 280) || '”' else '' end);
  return new;
end;
$$;
drop trigger if exists journal_activity on public.journal;
create trigger journal_activity after insert or update on public.journal
  for each row execute function private.on_journal();

-- Email new activity (runs every minute). Waits until a burst of taps has
-- settled for 45 seconds, then sends ONE email covering all of it.
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
    when n_check = 0 then kid || ' answered his postgame interview'
    when n_pg = 0 and n_check = 1 then (select title from public.activity where id = ids[1])
    when n_pg = 0 then kid || ' checked in ' || n_check || ' items for approval'
    else (n_check + n_pg) || ' new updates from ' || kid
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

select cron.schedule('clubhouse-email', '* * * * *', 'select private.send_activity_email()');

-- For the app's Notifications panel: my email setting, whether email is set
-- up, and how the last email went.
create or replace function public.my_notifications() returns json
language sql stable security definer set search_path = public, private as $$
  select case when public.is_parent() then json_build_object(
    'notify_email', (select notify_email from public.parents where lower(email) = lower(auth.jwt() ->> 'email')),
    'configured',   (select coalesce(api_key, '') <> '' from private.email_settings where id = 1),
    'last',         (select json_build_object('at', l.created_at, 'kind', l.kind, 'status', r.status_code,
                       'error', coalesce(r.error_msg, case when r.status_code >= 300 then left(r.content, 300) end))
                     from private.email_log l left join net._http_response r on r.id = l.request_id
                     order by l.created_at desc limit 1)
  ) end;
$$;
revoke execute on function public.my_notifications() from public, anon;
grant execute on function public.my_notifications() to authenticated;

create or replace function public.set_notify_email(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_parent() then raise exception 'Parents only'; end if;
  update public.parents set notify_email = p_on where lower(email) = lower(auth.jwt() ->> 'email');
end;
$$;
revoke execute on function public.set_notify_email(boolean) from public, anon;
grant execute on function public.set_notify_email(boolean) to authenticated;

create or replace function public.send_test_email() returns void
language plpgsql security definer set search_path = public, private as $$
declare
  s   private.email_settings;
  rid bigint;
begin
  if not public.is_parent() then raise exception 'Parents only'; end if;
  select * into s from private.email_settings where id = 1;
  if coalesce(s.api_key, '') = '' then
    raise exception 'Email isn''t set up yet. Add your Resend API key (see the README).';
  end if;
  select net.http_post(
    url := s.api_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || s.api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object('from', s.from_address, 'to', jsonb_build_array(auth.jwt() ->> 'email'),
      'subject', 'Test from The Clubhouse',
      'html', '<p style="font:15px Arial,sans-serif">Email notifications are working. You''ll get an email when Jaylen checks in a lineup item or answers his postgame interview.</p>')
  ) into rid;
  insert into private.email_log (request_id, kind) values (rid, 'test');
end;
$$;
revoke execute on function public.send_test_email() from public, anon;
grant execute on function public.send_test_email() to authenticated;

-- Live updates: new activity pops up on your phones right away.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activity') then
    alter publication supabase_realtime add table public.activity;
  end if;
end $$;


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
