-- ============================================================================
-- Reward Rocket 🚀 — add Jaylen's daily journal ("My Day")
--
-- Only needed if you ran setup.sql BEFORE the journal existed.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once. Points, prizes and behaviors are not changed.
-- ============================================================================

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

-- Jaylen's dashboard now also gets his recent journal entries (and your replies).
create or replace function public.kid_dashboard(p_token uuid)
returns json
language sql stable security definer set search_path = public
as $$
  select case when s.kid_token is distinct from p_token then null else json_build_object(
    'kid_name',  s.kid_name,
    'avatar_url', s.avatar_url,
    'journal_points', s.journal_points,
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


-- Live updates: a new entry shows up on your phones right away.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'journal') then
    alter publication supabase_realtime add table public.journal;
  end if;
end $$;
