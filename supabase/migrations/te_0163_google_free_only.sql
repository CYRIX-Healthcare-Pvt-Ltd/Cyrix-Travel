/*
  te_0163 — Google's roads only while they are free (the user, 18 Nov: "enable this only the free limit of 70000 is
  over, ie no extra cost"). Before each request the page asks te_google_take(): under the month's limit it is counted
  and Google is asked; at the limit the answer is no and the ride takes our own map, as everyone else's does, until the
  month turns. Google's month is US Pacific time (it turns about 1:30 pm on the 1st in India), so the count is too.
  The limit is 68,000 of the 70,000, room for requests Google counts that we do not see. Live's tile counts the same month.
*/
create or replace function public.te_google_month_start() returns timestamptz language sql stable as $$
  select date_trunc('month', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles'
$$;

create or replace function public.te_google_take() returns boolean
language plpgsql security definer set search_path = public as $$
declare used bigint;
begin
  perform pg_advisory_xact_lock(hashtext('te_google_take'));
  select count(*) into used from te_google_calls where at >= te_google_month_start();
  if used >= 68000 then return false; end if;
  insert into te_google_calls (employee_id) values (current_employee_id());
  return true;
end $$;
revoke all on function public.te_google_take() from public, anon;
grant execute on function public.te_google_take() to authenticated;

-- The old one counted after asking; nothing calls it now.
drop function if exists public.te_google_call();

do $$
declare f text;
  a text := $q$(select count(*) from te_google_calls g where g.at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')$q$;
begin
  f := pg_get_functiondef('public.te_usage(date, date)'::regprocedure);
  if position(a in f) = 0 then raise exception 'te_usage changed'; end if;
  f := replace(f, a, $q$(select count(*) from te_google_calls g where g.at >= te_google_month_start())$q$);
  execute f;
end $$;
