-- Skora: Gemini fallback models and fair daily limits.
--
-- 1. give_back_gemini_request: the read-handwriting Edge Function counts a
--    request before asking Gemini. When no Gemini model answers (all busy,
--    or the photo could not be read), it hands the request back, so failed
--    tries do not use up the day's limit.
-- 2. gemini_busy_models: a model that was overloaded, out of free quota or
--    too slow goes to the back of the line for a few minutes, so the next
--    script does not wait for it again.

create or replace function public.give_back_gemini_request(p_device text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
begin
  update public.gemini_usage g
     set requests = greatest(g.requests - 1, 0)
   where g.device_id = p_device and g.day = v_today;
end;
$$;

revoke all on function public.give_back_gemini_request(text) from public, anon, authenticated;
grant execute on function public.give_back_gemini_request(text) to service_role;

create table if not exists public.gemini_busy_models (
  model      text primary key check (length(model) between 1 and 80),
  busy_until timestamptz not null
);

alter table public.gemini_busy_models enable row level security;
-- No policies: only the Edge Function (service role) uses it, through the functions below.
revoke all on table public.gemini_busy_models from anon, authenticated;

-- The models in the order to try them: those not busy first, in the order
-- given; then the busy ones, the one free soonest first.
create or replace function public.gemini_model_order(p_models text[])
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.model order by
           coalesce(b.busy_until > now(), false),
           case when b.busy_until > now() then b.busy_until end,
           m.ord), '{}')
    from unnest(p_models) with ordinality as m(model, ord)
    left join public.gemini_busy_models b on b.model = m.model;
$$;

create or replace function public.mark_gemini_model_busy(p_model text, p_seconds integer)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.gemini_busy_models (model, busy_until)
  values (p_model, now() + make_interval(secs => least(greatest(p_seconds, 1), 3600)))
  on conflict (model) do update set busy_until = excluded.busy_until;
$$;

revoke all on function public.gemini_model_order(text[]) from public, anon, authenticated;
revoke all on function public.mark_gemini_model_busy(text, integer) from public, anon, authenticated;
grant execute on function public.gemini_model_order(text[]) to service_role;
grant execute on function public.mark_gemini_model_busy(text, integer) to service_role;
