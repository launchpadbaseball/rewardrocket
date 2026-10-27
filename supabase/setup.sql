-- ============================================================================
-- Reward Rocket 🚀 — database setup
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
  kid_token  uuid not null default gen_random_uuid()
);
insert into public.settings (id) values (1) on conflict do nothing;

create table if not exists public.behaviors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  emoji       text not null default '⭐',
  points      int  not null check (points > 0),
  once_daily  boolean not null default true,   -- can only be earned once per day
  sort        int  not null default 0,
  created_at  timestamptz not null default now()
);

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
  kind         text not null check (kind in ('earn', 'adjust', 'redeem')),
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
    'balance',   (select coalesce(sum(points), 0) from public.ledger),
    'behaviors', coalesce((select json_agg(json_build_object(
                    'id', b.id, 'name', b.name, 'emoji', b.emoji,
                    'points', b.points, 'once_daily', b.once_daily
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


-- 6. Live updates between the two phones --------------------------------------

do $$
declare t text;
begin
  foreach t in array array['ledger', 'behaviors', 'rewards', 'settings'] loop
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
  ('Good behavior at school',            '🏫', 4, true,  9),
  ('Good sportsmanship',                 '🏆', 5, false, 10)
) v(name, emoji, points, once_daily, sort)
where not exists (select 1 from public.behaviors);

insert into public.rewards (name, emoji, cost, sort)
select * from (values
  ('Small Squishy',   '🧸', 30, 1),
  ('Regular NeeDoh',  '🟣', 50, 2),
  ('Special NeeDoh',  '🌈', 100, 3)
) v(name, emoji, cost, sort)
where not exists (select 1 from public.rewards);
