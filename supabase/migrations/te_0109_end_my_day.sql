/*
  te_0109 — End my day (the user, 4 Nov: "should we add end my day button? Like same start location confirmation?",
  then "Ya"). One press a day, on a fixed map, keeps where the phone was and when; the claim's last ride ends there,
  locked. After midnight, until the new day is started, it ends the day before (te_late_day), and that closes the day
  before's trip. A day's photos after its end are refused. It takes the place of the photo at home (te_0108), which goes.
  Observations from te_policy 'day_end_from' (5 Nov 2026; the test accounts from today, te_rule_from).
*/
insert into public.te_policy (key, value) values ('day_end_from', to_jsonb('2026-11-05'::text)) on conflict (key) do nothing;

create table if not exists public.te_day_ends (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  day         date not null,
  at          timestamptz not null default now(),
  lat         double precision not null,
  lng         double precision not null,
  accuracy    real,
  place       text,
  unique (employee_id, day)
);
alter table public.te_day_ends enable row level security;
-- Read and written through the functions below only.

-- The day before, while its trip may still go on: not ended either.
create or replace function public.te_late_day(p_emp uuid) returns date
 language sql stable security definer set search_path to 'public' as $$
  select y from (select (now() at time zone 'Asia/Kolkata')::date - 1 as y, (now() at time zone 'Asia/Kolkata')::date as t) d
   where (exists (select 1 from te_day_starts s where s.employee_id = p_emp and s.day = d.y)
          or exists (select 1 from te_visit_photos v where v.employee_id = p_emp and v.day = d.y))
     and not exists (select 1 from te_day_ends e where e.employee_id = p_emp and e.day = d.y)
     and not exists (select 1 from te_day_starts s where s.employee_id = p_emp and s.day = d.t)
     and not exists (select 1 from te_visit_photos v where v.employee_id = p_emp and v.day = d.t)
$$;
revoke all on function public.te_late_day(uuid) from public, anon, authenticated;

create or replace function public.te_my_day()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'required', coalesce(te_rule_from('day_start_from', current_employee_id()) <= (now() at time zone 'Asia/Kolkata')::date, false),
    'start', (select jsonb_build_object('at', s.at, 'lat', s.lat, 'lng', s.lng, 'place', s.place,
                'home_m', (select round(te_m(h.lat, h.lng, s.lat, s.lng)) from travel_homes h where h.employee_id = s.employee_id))
              from te_day_starts s where s.employee_id = current_employee_id() and s.day = (now() at time zone 'Asia/Kolkata')::date),
    'end', (select jsonb_build_object('day', e.day, 'at', e.at, 'lat', e.lat, 'lng', e.lng, 'place', e.place)
              from te_day_ends e where e.employee_id = current_employee_id() and e.day = (now() at time zone 'Asia/Kolkata')::date),
    'late_day', te_late_day(current_employee_id()))
$$;

create or replace function public.te_end_day(p_lat double precision, p_lng double precision, p_accuracy real default null, p_place text default null)
returns date language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_employee_id();
  the_day date := coalesce(te_late_day(current_employee_id()), (now() at time zone 'Asia/Kolkata')::date);
begin
  if not travel_has_access() then raise exception 'Travel Expense has not been given to you yet'; end if;
  if not travel_point_ok(p_lat, p_lng) then raise exception 'Your location could not be read — allow location and try again'; end if;
  if p_accuracy is null or p_accuracy > 500 then
    raise exception 'Your location is not exact enough (± % m). Press Try again', coalesce(round(p_accuracy)::text, '?');
  end if;
  if not exists (select 1 from te_day_starts where employee_id = me and day = the_day)
     and not exists (select 1 from te_visit_photos where employee_id = me and day = the_day) then
    raise exception 'Start your day first';
  end if;
  if exists (select 1 from te_day_ends where employee_id = me and day = the_day) then
    raise exception '% is already ended', to_char(the_day, 'FMDD Mon');
  end if;
  insert into te_day_ends (employee_id, day, lat, lng, accuracy, place)
  values (me, the_day, p_lat, p_lng, p_accuracy, nullif(btrim(coalesce(p_place, '')), ''));
  return the_day;
end $$;
revoke all on function public.te_end_day(double precision, double precision, real, text) from public, anon;
grant execute on function public.te_end_day(double precision, double precision, real, text) to authenticated;

create or replace function public.te_my_ends(p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('day', e.day, 'at', e.at, 'lat', e.lat, 'lng', e.lng, 'place', e.place,
      'home_m', (select round(te_m(h.lat, h.lng, e.lat, e.lng)) from travel_homes h where h.employee_id = e.employee_id)) order by e.day desc), '[]')
  from te_day_ends e where e.employee_id = current_employee_id() and e.day between p_from and p_to
$$;
revoke all on function public.te_my_ends(date, date) from public, anon;
grant execute on function public.te_my_ends(date, date) to authenticated;

create or replace function public.te_claim_starts(p_claim uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c te_claims;
begin
  if not te_can_see(p_claim) then raise exception 'That claim is not yours to see'; end if;
  select * into c from te_claims where id = p_claim;
  return jsonb_build_object(
    'from', te_rule_from('day_start_from', c.employee_id),
    'starts', coalesce((select jsonb_agg(jsonb_build_object('day', s.day, 'at', s.at, 'lat', s.lat, 'lng', s.lng, 'place', s.place,
        'home_m', (select round(te_m(h.lat, h.lng, s.lat, s.lng)) from travel_homes h where h.employee_id = s.employee_id)) order by s.day)
      from te_day_starts s where s.employee_id = c.employee_id and s.day >= c.month and s.day < (c.month + interval '1 month')::date), '[]'),
    'end_from', te_rule_from('day_end_from', c.employee_id),
    'ends', coalesce((select jsonb_agg(jsonb_build_object('day', e.day, 'at', e.at, 'lat', e.lat, 'lng', e.lng, 'place', e.place,
        'home_m', (select round(te_m(h.lat, h.lng, e.lat, e.lng)) from travel_homes h where h.employee_id = e.employee_id)) order by e.day)
      from te_day_ends e where e.employee_id = c.employee_id and e.day >= c.month and e.day < (c.month + interval '1 month')::date), '[]'));
end $$;

-- The photo at home (te_0108) goes: End my day stands for it.
delete from public.te_policy where key = 'home_photo_from';
create or replace function public.te_visit_setup()
 returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select jsonb_build_object(
    'on', coalesce((te_pol('visit_photos'))::text::boolean, false),
    'near_m', coalesce((te_pol('photo_near_m'))::text::numeric, 500),
    'skips', coalesce((te_pol('photo_skips'))::text::int, 3),
    'after', coalesce(te_pol('photo_after') #>> '{}', 'block'),
    'keep_days', coalesce((te_pol('photo_keep_days'))::text::int, 90),
    'needs', (select coalesce(jsonb_agg(label order by sort), '[]') from te_purposes where photo_needed and is_active),
    'speed_on', coalesce((te_pol('photo_speed_on'))::text::boolean, true),
    'speeds', coalesce(te_pol('photo_speeds'), '{}'::jsonb))
$function$;

do $$
declare f text;
  x_new text := $q$and x.to_lat is not null and (lower(btrim(split_part(coalesce(x.to_name, ''), ',', 1))) <> 'home' or d.day >= coalesce(te_rule_from('home_photo_from', owner), '2999-12-31'))$q$;
  x_old text := $q$and x.to_lat is not null and lower(btrim(split_part(coalesce(x.to_name, ''), ',', 1))) <> 'home'$q$;
  r_new text := $q$and r.to_lat is not null and (lower(btrim(split_part(coalesce(r.to_name, ''), ',', 1))) <> 'home' or d.day >= coalesce(te_rule_from('home_photo_from', c.employee_id), '2999-12-31'))$q$;
  r_old text := $q$and r.to_lat is not null and lower(btrim(split_part(coalesce(r.to_name, ''), ',', 1))) <> 'home'$q$;
  ph_at text := $q$  insert into te_visit_photos (employee_id, day, shot_at$q$;
begin
  f := pg_get_functiondef('public.te_rides_without_photo(uuid)'::regprocedure);
  if position(x_new in f) = 0 then raise exception 'te_rides_without_photo changed'; end if;
  execute replace(f, x_new, x_old);
  f := pg_get_functiondef('public.te_submit(uuid)'::regprocedure);
  if position(r_new in f) = 0 then raise exception 'te_submit changed'; end if;
  execute replace(f, r_new, r_old);
  -- A photo taken after its day was ended is refused; one taken before and sent later still goes.
  f := pg_get_functiondef('public.te_photo_add(text, double precision, double precision, real, timestamp with time zone, text, text, text, text, date)'::regprocedure);
  if position(ph_at in f) = 0 then raise exception 'te_photo_add changed'; end if;
  execute replace(f, ph_at, $q$  if exists (select 1 from te_day_ends e where e.employee_id = me and e.day = coalesce(p_day, (p_shot_at at time zone 'Asia/Kolkata')::date) and e.at < p_shot_at) then
    raise exception '% is ended in the app. A photo after it can''t be added', to_char(coalesce(p_day, (p_shot_at at time zone 'Asia/Kolkata')::date), 'FMDD Mon');
  end if;
$q$ || ph_at);
end $$;
