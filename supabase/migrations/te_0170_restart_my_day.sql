-- =====================================================================
-- Travel  ·  te_0170  ·  Restart my day
--
-- The user, 21 Nov: "suppose i end my day at 6 pm, suddenly a ticket came, need to go to hospital, started 9 pm".
-- After End my day, Restart my day reads where the person is (as Start my day does) and asks why (required).
-- The day is open again: the camera comes back, and End my day is pressed again later; that end is the day's end.
-- The end it replaced is kept in the restart row, so nothing is lost. No limit on how often (the user).
-- Today only; the late-night rule for after midnight is unchanged.
-- =====================================================================

create table if not exists public.te_day_restarts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  day date not null,
  at timestamptz not null default now(),
  lat double precision not null, lng double precision not null, accuracy real, place text,
  reason text not null check (btrim(reason) <> ''),
  ended_at timestamptz not null, ended_lat double precision, ended_lng double precision, ended_place text
);
create index if not exists te_day_restarts_emp_day on public.te_day_restarts (employee_id, day);
alter table public.te_day_restarts enable row level security;
revoke all on public.te_day_restarts from anon, authenticated;

create or replace function public.te_restart_day(p_lat double precision, p_lng double precision, p_accuracy real, p_place text, p_reason text)
 returns date language plpgsql security definer set search_path to 'public' as $function$
declare me uuid := current_employee_id(); the_day date := (now() at time zone 'Asia/Kolkata')::date; e te_day_ends;
begin
  if not travel_has_access() then raise exception 'Travel Expense has not been given to you yet'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Write why you are going out again'; end if;
  if not travel_point_ok(p_lat, p_lng) then raise exception 'Your location could not be read — allow location and try again'; end if;
  if p_accuracy is null or p_accuracy > 500 then
    raise exception 'Your location is not exact enough (± % m). Press Try again', coalesce(round(p_accuracy)::text, '?');
  end if;
  select * into e from te_day_ends where employee_id = me and day = the_day;
  if e.id is null then raise exception 'Today is not ended'; end if;
  insert into te_day_restarts (employee_id, day, lat, lng, accuracy, place, reason, ended_at, ended_lat, ended_lng, ended_place)
  values (me, the_day, p_lat, p_lng, p_accuracy, nullif(btrim(coalesce(p_place, '')), ''), btrim(p_reason), e.at, e.lat, e.lng, e.place);
  delete from te_day_ends where id = e.id;
  return the_day;
end $function$;
revoke all on function public.te_restart_day(double precision, double precision, real, text, text) from public, anon;
grant execute on function public.te_restart_day(double precision, double precision, real, text, text) to authenticated;

-- The person's own restarts in a range (the Photo page draws them as tiles).
create or replace function public.te_my_restarts(p_from date, p_to date)
 returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('day', r.day, 'at', r.at, 'lat', r.lat, 'lng', r.lng, 'place', r.place, 'reason', r.reason, 'ended_at', r.ended_at) order by r.at), '[]')
  from te_day_restarts r where r.employee_id = current_employee_id() and r.day between p_from and p_to
$function$;
revoke all on function public.te_my_restarts(date, date) from public, anon;
grant execute on function public.te_my_restarts(date, date) to authenticated;

-- The claim's starts gain 'restarts' (as live, plus that key).
create or replace function public.te_claim_starts(p_claim uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare c te_claims;
begin
  if not te_can_see(p_claim) then raise exception 'That claim is not yours to see'; end if;
  select * into c from te_claims where id = p_claim;
  return jsonb_build_object(
    'from', te_rule_from('day_start_from', c.employee_id),
    'starts', coalesce((select jsonb_agg(jsonb_build_object('day', s.day, 'at', s.at, 'lat', s.lat, 'lng', s.lng, 'place', s.place,
        'home_m', (select round(te_m(h.lat, h.lng, s.lat, s.lng)) from travel_homes h where h.employee_id = s.employee_id), 'home_limit', te_home_limit_m()) order by s.day)
      from te_day_starts s where s.employee_id = c.employee_id and s.day >= c.month and s.day < (c.month + interval '1 month')::date), '[]'),
    'end_from', te_rule_from('day_end_from', c.employee_id),
    'end_first_from', te_end_first_from(c.employee_id),
    'ends', coalesce((select jsonb_agg(jsonb_build_object('day', e.day, 'at', e.at, 'lat', e.lat, 'lng', e.lng, 'place', e.place,
        'home_m', (select round(te_m(h.lat, h.lng, e.lat, e.lng)) from travel_homes h where h.employee_id = e.employee_id), 'home_limit', te_home_limit_m()) order by e.day)
      from te_day_ends e where e.employee_id = c.employee_id and e.day >= c.month and e.day < (c.month + interval '1 month')::date), '[]'),
    'restarts', coalesce((select jsonb_agg(jsonb_build_object('day', r.day, 'at', r.at, 'lat', r.lat, 'lng', r.lng, 'place', r.place, 'reason', r.reason,
        'ended_at', r.ended_at, 'home_m', (select round(te_m(h.lat, h.lng, r.lat, r.lng)) from travel_homes h where h.employee_id = r.employee_id), 'home_limit', te_home_limit_m()) order by r.at)
      from te_day_restarts r where r.employee_id = c.employee_id and r.day >= c.month and r.day < (c.month + interval '1 month')::date), '[]'));
end $function$;
