-- =====================================================================
-- Skora · Supabase (project "Zelvo")
--
-- Skora keeps all its data on the teacher's phone, with no log-in.
-- Supabase is used for one job only: the read-handwriting Edge
-- Function passes unclear handwriting to Gemini, so the Gemini key
-- never sits inside the APK. This file:
--   0. Removes the old, empty Zelvo tables and functions
--   1. Adds a small table that counts Gemini requests per phone per day
--   2. Adds the function the Edge Function calls before each request
--
-- Applied to the project on 26 Nov 2026 as migration 20261126160101_skora_gemini_helper.
-- Safe to run again: part 0 skips itself once the old tables are gone.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Remove the old Zelvo schema
-- ---------------------------------------------------------------------
-- Skipped if the old tables are already gone. Stops with an error, and
-- changes nothing, if any old table still holds data (the one-row
-- owner list is the only exception).
do $$
declare
  old_tables text[] := array[
    'announcements', 'app_activity', 'classes', 'exam_papers', 'exam_periods',
    'exams', 'lessons', 'periods', 'platform_admins', 'schools', 'scripts',
    'staff', 'staff_invites', 'staff_requests', 'staff_subjects',
    'student_accounts', 'student_invites', 'students', 'subjects'];
  t text;
  n bigint;
  r record;
begin
  if to_regclass('public.staff_invites') is null then
    raise notice 'Old Zelvo tables not found; part 0 skipped.';
    return;
  end if;

  foreach t in array old_tables loop
    if t <> 'platform_admins' and to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then
        raise exception 'Old table public.% still has % rows, so nothing was changed.', t, n;
      end if;
    end if;
  end loop;

  drop trigger if exists zelvo_make_owner_on_signup on auth.users;

  -- Storage rules of the old "scripts" bucket use the old tables.
  drop policy if exists "Script images: view"    on storage.objects;
  drop policy if exists "Script images: add"     on storage.objects;
  drop policy if exists "Script images: replace" on storage.objects;
  drop policy if exists "Script images: delete"  on storage.objects;

  foreach t in array old_tables loop
    execute format('drop table if exists public.%I cascade', t);
  end loop;

  -- Old Zelvo functions in public and private (none belong to extensions).
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname in ('public', 'private')
       and p.prokind = 'f'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;

  drop table if exists private.owner_emails;
end $$;

-- ---------------------------------------------------------------------
-- 1. Gemini requests per phone per day
-- ---------------------------------------------------------------------
-- device_id is the random id stored in the phone's settings table.
-- Only the Edge Function (service role) reads or writes this table.
create table if not exists public.gemini_usage (
  device_id  text not null check (device_id ~ '^[0-9a-f]{32}$'),
  day        date not null,
  requests   integer not null default 0 check (requests >= 0),
  primary key (device_id, day)
);
create index if not exists gemini_usage_day on public.gemini_usage (day);

alter table public.gemini_usage enable row level security;
-- No policies on purpose: the app's public key cannot read or change it.
revoke all on public.gemini_usage from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. take_gemini_request: called by the Edge Function before Gemini
-- ---------------------------------------------------------------------
-- Counts one request for the phone and returns true if both limits
-- still allow it:
--   p_per_phone  most requests one phone may make in a day (UTC)
--   p_all_phones most requests all phones together may make in a day,
--                kept under the Gemini free tier's daily limit
-- A refused request is not counted. Rows older than 30 days are
-- cleared as it goes.
create or replace function public.take_gemini_request(
  p_device     text,
  p_per_phone  integer,
  p_all_phones integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_phone integer;
  v_all   integer;
begin
  if p_device is null or p_device !~ '^[0-9a-f]{32}$' then
    return false;
  end if;

  -- One request at a time, so two phones cannot both take the last one.
  perform pg_advisory_xact_lock(hashtext('skora_gemini_usage'));

  select coalesce(sum(g.requests), 0) into v_all
    from public.gemini_usage g
   where g.day = v_today;

  select coalesce(max(g.requests), 0) into v_phone
    from public.gemini_usage g
   where g.device_id = p_device and g.day = v_today;

  if v_phone >= p_per_phone or v_all >= p_all_phones then
    return false;
  end if;

  insert into public.gemini_usage as g (device_id, day, requests)
  values (p_device, v_today, 1)
  on conflict (device_id, day) do update set requests = g.requests + 1;

  delete from public.gemini_usage g where g.day < v_today - 30;

  return true;
end;
$$;

revoke all on function public.take_gemini_request(text, integer, integer) from public, anon, authenticated;
grant execute on function public.take_gemini_request(text, integer, integer) to service_role;


-- After running:
--   * Storage still has the old, empty "scripts" bucket. Skora does not
--     use it; delete it in Storage if you like (SQL cannot delete it).
--   * Old test sign-ups stay under Authentication > Users. Skora has no
--     log-in, so you can delete them there.
