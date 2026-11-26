/*
  te_0137 — What the Watch has found, kept (the user, 7 Nov: "ya add the log, in that it will see what was corrected
  isnt?"; the Watch is what is shown to management, "with our app we have found this much"). Every sign the Watch
  shows is written down the first time it is seen; one no longer seen is marked corrected, with when — the claim sent
  back and put right, the bill replaced. Seen again, it is open again. Real people only, as the Watch.

  A sign is the same sign by its kind, person, day and words, a claim's number left out (a draft gets one when sent).
  Kept fresh every 30 minutes, and whenever SW Admin opens what was found.
*/
create table if not exists public.te_watch_log (
  key text primary key,
  employee_id uuid not null,
  kind text not null, weight text not null, day date not null,
  claim text, status text, detail text not null, amount numeric,
  found_at timestamptz not null default now(),
  seen_at timestamptz not null default now(),
  corrected_at timestamptz
);
alter table public.te_watch_log enable row level security;
revoke all on public.te_watch_log from anon, authenticated;

-- The Watch itself may be run by the scheduled job (as the database), besides SW Admin.
do $$
declare f text;
  was text := $q$if not is_sw_admin() then raise exception 'Only SW Admin sees this'; end if;$q$;
begin
  f := pg_get_functiondef('public.te_watch(date,date)'::regprocedure);
  if position('session_user' in f) > 0 then return; end if;
  if position(was in f) = 0 then raise exception 'te_watch changed'; end if;
  execute replace(f, was, $q$if session_user <> 'postgres' and not is_sw_admin() then raise exception 'Only SW Admin sees this'; end if;$q$);
end $$;

create or replace function public.te_watch_sync()
returns void language plpgsql security definer set search_path = public as $$
declare t0 timestamptz := clock_timestamp(); w jsonb;
begin
  if session_user <> 'postgres' and not is_sw_admin() then raise exception 'Only SW Admin sees this'; end if;
  w := te_watch(null, null);
  insert into te_watch_log as l (key, employee_id, kind, weight, day, claim, status, detail, amount, found_at, seen_at)
  select distinct on (k.key) k.key, e.id, s->>'kind', s->>'weight', (s->>'day')::date, s->>'claim', s->>'status', s->>'detail', (s->>'amount')::numeric, t0, t0
  from jsonb_array_elements(w->'people') p
  join employees e on e.ecode = p->>'ecode'
  cross join lateral jsonb_array_elements(p->'signs') s
  cross join lateral (select md5(concat_ws('|', s->>'kind', e.id, s->>'day',
    regexp_replace(s->>'detail', 'on (TE-[0-9]+|a claim not sent yet)', '', 'g'))) key) k
  on conflict (key) do update set seen_at = t0, corrected_at = null, weight = excluded.weight,
    claim = excluded.claim, status = excluded.status, detail = excluded.detail, amount = excluded.amount;
  update te_watch_log set corrected_at = t0 where corrected_at is null and seen_at < t0;
end $$;
revoke all on function public.te_watch_sync() from public, anon;
grant execute on function public.te_watch_sync() to authenticated;

-- What was found, for SW Admin: each sign, who, when found and when corrected.
create or replace function public.te_watch_found()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_sw_admin() then raise exception 'Only SW Admin sees this'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'kind', l.kind, 'weight', l.weight, 'day', l.day, 'claim', l.claim, 'status', l.status, 'detail', l.detail, 'amount', l.amount,
      'found_at', l.found_at, 'corrected_at', l.corrected_at, 'ecode', e.ecode, 'name', e.full_name,
      'function', nullif(btrim(e.function_name), ''))
    order by l.found_at desc, l.day desc)
    from te_watch_log l join employees e on e.id = l.employee_id), '[]');
end $$;
revoke all on function public.te_watch_found() from public, anon;
grant execute on function public.te_watch_found() to authenticated;

select cron.unschedule('te-watch-log') where exists (select 1 from cron.job where jobname = 'te-watch-log');
select cron.schedule('te-watch-log', '*/30 * * * *', $$select public.te_watch_sync()$$);
select public.te_watch_sync();
