-- te_0107: a day is started only on a location the phone is sure of to 500 m (the user, 4 Nov: "more than 500 he
-- should press try again"); a rougher one is read again with Try again.
create or replace function public.te_start_day(p_lat double precision, p_lng double precision, p_accuracy real default null, p_place text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_employee_id();
  today date := (now() at time zone 'Asia/Kolkata')::date;
  first_shot timestamptz;
begin
  if not travel_has_access() then raise exception 'Travel Expense has not been given to you yet'; end if;
  if not travel_point_ok(p_lat, p_lng) then raise exception 'Your location could not be read — allow location and try again'; end if;
  if p_accuracy is null or p_accuracy > 500 then
    raise exception 'Your location is not exact enough (± % m). Press Try again', coalesce(round(p_accuracy)::text, '?');
  end if;
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
