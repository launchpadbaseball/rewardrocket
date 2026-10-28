-- ============================================================================
-- The Clubhouse — notifications (in-app + email)
--
-- Only needed if you ran setup.sql BEFORE notifications existed.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once. Nothing you already have is changed.
--
-- Then turn on email (see the README, "Email notifications"):
--   update private.email_settings set api_key = 're_your_key_here';
-- ============================================================================

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
