/*
  te_0103 — a home can be changed a few times a month (the user, 3 Nov: "max 3 time home can be changed in a month,
  and set that rule too and sw admin can change it also"). te_policy 'home_changes_month' (3), set by SW Admin only.
  A change is a move of more than 200 m from a saved home (te_home_moves with a from point); the first mark is not one.
  The month is the calendar month in India.
*/
insert into public.te_policy (key, value) values ('home_changes_month', to_jsonb(3))
on conflict (key) do nothing;

-- How many changes the month allows and how many this person has made.
create or replace function public.te_home_changes()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'limit', coalesce((te_pol('home_changes_month') #>> '{}')::int, 3),
    'used', (select count(*) from te_home_moves m
             where m.employee_id = current_employee_id() and m.from_lat is not null
               and (m.at at time zone 'Asia/Kolkata') >= date_trunc('month', now() at time zone 'Asia/Kolkata')))
$$;
revoke all on function public.te_home_changes() from public, anon;
grant execute on function public.te_home_changes() to authenticated;

create or replace function public.travel_set_home(p_lat double precision, p_lng double precision, p_how text default 'here')
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare was travel_homes; me uuid := current_employee_id(); far numeric; ch jsonb;
begin
  if not travel_has_access() then raise exception 'Travel Expense has not been given to you yet'; end if;
  if coalesce(p_how, '') not in ('here', 'map') then raise exception 'Mark your home by standing there or on the map'; end if;
  if not travel_point_ok(p_lat, p_lng) then
    raise exception '%', case when p_how = 'map' then 'Choose your home on the map' else 'Your location could not be read — allow location and try again' end;
  end if;
  select * into was from travel_homes where employee_id = me;
  far := case when was.employee_id is null then null else round(te_km(was.lat, was.lng, p_lat, p_lng)::numeric, 1) end;
  if was.employee_id is not null and far > 0.2 then
    ch := te_home_changes();
    if (ch ->> 'used')::int >= (ch ->> 'limit')::int then
      raise exception 'Home can be changed only % times a month — this month''s are used', ch ->> 'limit';
    end if;
  end if;
  insert into travel_homes (employee_id, lat, lng, how) values (me, p_lat, p_lng, p_how)
  on conflict (employee_id) do update set lat = excluded.lat, lng = excluded.lng, how = excluded.how, set_at = now();
  -- The first mark, and any move of more than 200 m (a phone reading wanders a little).
  if was.employee_id is null or far > 0.2 then
    insert into te_home_moves (employee_id, from_lat, from_lng, to_lat, to_lng, km, how)
    values (me, was.lat, was.lng, p_lat, p_lng, far, p_how);
  end if;
end $function$;
revoke all on function public.travel_set_home(double precision, double precision, text) from public, anon;
grant execute on function public.travel_set_home(double precision, double precision, text) to authenticated;

-- te_0089's, with the home changes a month SW Admin's alone.
create or replace function public.te_set_policy(p_key text, p_value jsonb)
 returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  if p_key in ('visit_photos', 'photo_near_m', 'photo_skips', 'photo_after', 'photo_keep_days', 'photo_speed_on', 'photo_speeds') and not is_sw_admin() then
    raise exception 'Only SW Admin sets visit photos';
  end if;
  if p_key = 'home_changes_month' then
    if not is_sw_admin() then raise exception 'Only SW Admin sets home changes a month'; end if;
    if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric not between 1 and 31 then
      raise exception 'Give a number from 1 to 31';
    end if;
  end if;
  if p_key = 'photo_speeds' and (jsonb_typeof(p_value) <> 'object' or exists (
       select 1 from jsonb_each(p_value) e
        where e.key not in ('bike', 'car', 'bus', 'train', 'metro', 'auto', 'taxi', 'taxi_bike')
           or jsonb_typeof(e.value) <> 'number' or (e.value #>> '{}')::numeric not between 5 and 300)) then
    raise exception 'Give each a speed from 5 to 300 km/h';
  end if;
  update te_policy set value = p_value, updated_at = now() where key = p_key;
  if not found then raise exception 'No such setting'; end if;
end $function$;
