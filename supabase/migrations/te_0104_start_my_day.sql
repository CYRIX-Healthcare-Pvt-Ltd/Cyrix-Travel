/*
  te_0104 — Start my day (the user, 3 Nov: "i marked home at edappaly, and i stayed at vytilla, and i came to offc ie 3
  km from vytilla and i claimed from edappaly, so what to do?"; then "ok do it … start my day from 2mrw"). One press a
  day, before the day's first visit photo, keeps where the phone was and when. The app starts the day's first ride
  there ("Home" when within 500 m of the saved home) and does not let it be changed; the claim's observations say a
  day not started, a start far from home, and a first ride from elsewhere. From te_policy 'day_start_from' (4 Nov 2026).
*/
insert into public.te_policy (key, value) values ('day_start_from', to_jsonb('2026-11-04'::text))
on conflict (key) do nothing;

create table if not exists public.te_day_starts (
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
alter table public.te_day_starts enable row level security;
-- Read and written through the functions below only.

-- Today's start, and whether the press is wanted yet.
create or replace function public.te_my_day()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'required', coalesce(nullif(te_pol('day_start_from') #>> '{}', '')::date <= (now() at time zone 'Asia/Kolkata')::date, false),
    'start', (select jsonb_build_object('at', s.at, 'lat', s.lat, 'lng', s.lng, 'place', s.place,
                'home_m', (select round(te_m(h.lat, h.lng, s.lat, s.lng)) from travel_homes h where h.employee_id = s.employee_id))
              from te_day_starts s where s.employee_id = current_employee_id() and s.day = (now() at time zone 'Asia/Kolkata')::date))
$$;
revoke all on function public.te_my_day() from public, anon;
grant execute on function public.te_my_day() to authenticated;

create or replace function public.te_start_day(p_lat double precision, p_lng double precision, p_accuracy real default null, p_place text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_employee_id();
  today date := (now() at time zone 'Asia/Kolkata')::date;
  first_shot timestamptz;
begin
  if not travel_has_access() then raise exception 'Travel Expense has not been given to you yet'; end if;
  if not travel_point_ok(p_lat, p_lng) then raise exception 'Your location could not be read — allow location and try again'; end if;
  if exists (select 1 from te_day_starts where employee_id = me and day = today) then
    raise exception 'Your day is already started';
  end if;
  -- Before the day's first visit photo only: a start pressed in the evening says nothing of the morning.
  select min(shot_at) into first_shot from te_visit_photos where employee_id = me and day = today;
  if first_shot is not null then
    raise exception 'Your first visit photo today was at % — a day starts before it',
      to_char(first_shot at time zone 'Asia/Kolkata', 'FMHH12:MI am');
  end if;
  insert into te_day_starts (employee_id, day, lat, lng, accuracy, place)
  values (me, today, p_lat, p_lng, p_accuracy, nullif(btrim(coalesce(p_place, '')), ''));
end $$;
revoke all on function public.te_start_day(double precision, double precision, real, text) from public, anon;
grant execute on function public.te_start_day(double precision, double precision, real, text) to authenticated;

-- A claim's day starts, with how far each was from the saved home, for the claim page and its observations.
create or replace function public.te_claim_starts(p_claim uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c te_claims;
begin
  if not te_can_see(p_claim) then raise exception 'That claim is not yours to see'; end if;
  select * into c from te_claims where id = p_claim;
  return jsonb_build_object(
    'from', nullif(te_pol('day_start_from') #>> '{}', '')::date,
    'starts', coalesce((select jsonb_agg(jsonb_build_object('day', s.day, 'at', s.at, 'lat', s.lat, 'lng', s.lng, 'place', s.place,
        'home_m', (select round(te_m(h.lat, h.lng, s.lat, s.lng)) from travel_homes h where h.employee_id = s.employee_id)) order by s.day)
      from te_day_starts s where s.employee_id = c.employee_id and s.day >= c.month and s.day < (c.month + interval '1 month')::date), '[]'));
end $$;
revoke all on function public.te_claim_starts(uuid) from public, anon;
grant execute on function public.te_claim_starts(uuid) to authenticated;

-- The person's own starts over some days, shown first among that day's visit photos with a drawn picture (the user,
-- 3 Nov: "instead of take visit photo, make it as start my day, so save that location (non editable location) with a
-- default logical image, if that only then take visit photo").
create or replace function public.te_my_starts(p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('day', s.day, 'at', s.at, 'lat', s.lat, 'lng', s.lng, 'place', s.place,
      'home_m', (select round(te_m(h.lat, h.lng, s.lat, s.lng)) from travel_homes h where h.employee_id = s.employee_id)) order by s.day desc), '[]')
  from te_day_starts s where s.employee_id = current_employee_id() and s.day between p_from and p_to
$$;
revoke all on function public.te_my_starts(date, date) from public, anon;
grant execute on function public.te_my_starts(date, date) to authenticated;
