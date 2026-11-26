/*
  te_0123 — Aurum's rules, Part 2: per diem or actual food, and the fixed miscellaneous allowance (Domestic Travel
  Policy V2/2026, Sections A1 and A4). For grades E1–E6 the day's Daily allowance is one of:
    none                   local travel — no allowance (Local Conveyance policy);
    aurum_actual           outstation, food and the rest at actual (claimed as other expenses), plus misc;
    aurum_per_diem         outstation, per diem in full, plus misc — only with no room claimed that night;
    aurum_per_diem_lodging per diem at 50%, lodging provided by the company or a customer, plus misc;
    aurum_per_diem_board   per diem at 25%, lodging and food provided, plus misc.
  The misc is one day's fixed miscellaneous allowance. The amount kept on the day is per diem + misc.
    Per diem  E1–E2 ₹1,200, E3–E4 ₹1,450, E5–E6 ₹1,700.  Misc  ₹250 / ₹300 / ₹350.
  A day trip (under 24 hours, no night away) is at actual within E1–E2 ₹1,000 metro / ₹750 other, E3–E4 ₹2,000 / ₹1,400,
  E5–E6 ₹3,000 / ₹2,000: kept here for the claim page to check.
*/
alter table public.te_grade_rules add column if not exists per_diem numeric;
alter table public.te_grade_rules add column if not exists misc_day numeric;
alter table public.te_grade_rules add column if not exists day_trip_metro numeric;
alter table public.te_grade_rules add column if not exists day_trip_other numeric;
comment on column public.te_grade_rules.per_diem is 'Aurum per diem a day; set means the grade uses per diem instead of DA.';

update public.te_grade_rules set per_diem = 1200, misc_day = 250, day_trip_metro = 1000, day_trip_other = 750 where grade in ('E1', 'E2') and per_diem is null;
update public.te_grade_rules set per_diem = 1450, misc_day = 300, day_trip_metro = 2000, day_trip_other = 1400 where grade in ('E3', 'E4') and per_diem is null;
update public.te_grade_rules set per_diem = 1700, misc_day = 350, day_trip_metro = 3000, day_trip_other = 2000 where grade in ('E5', 'E6') and per_diem is null;

alter table public.te_days drop constraint if exists te_days_da_kind_check;
alter table public.te_days add constraint te_days_da_kind_check
  check (da_kind in ('none', 'in_district', 'out_district', 'out_state', 'out_state_stay', 'deputation',
                     'aurum_actual', 'aurum_per_diem', 'aurum_per_diem_lodging', 'aurum_per_diem_board'));

create or replace function public.te_da(p_grade text, p_kind text, p_purpose text)
 returns numeric language plpgsql stable security definer set search_path to 'public' as $function$
declare r te_grade_rules := te_rule(p_grade);
begin
  if exists (select 1 from te_purposes where label = p_purpose and not gives_da) then return 0; end if;
  return case p_kind when 'in_district' then r.da_in_district when 'out_district' then r.da_out_district
    when 'out_state' then r.da_out_state when 'out_state_stay' then r.da_out_state_stay
    when 'deputation' then coalesce((select (value #>> '{}')::numeric from te_policy where key = 'deputation_da'), 800)
    when 'aurum_actual' then coalesce(r.misc_day, 0)
    when 'aurum_per_diem' then coalesce(r.per_diem, 0) + coalesce(r.misc_day, 0)
    when 'aurum_per_diem_lodging' then round(coalesce(r.per_diem, 0) * 0.5) + coalesce(r.misc_day, 0)
    when 'aurum_per_diem_board' then round(coalesce(r.per_diem, 0) * 0.25) + coalesce(r.misc_day, 0)
    else 0 end;
end $function$;

-- Per diem is paid only when no room is claimed for the night (A4); the reduced ones are for lodging provided.
do $$
declare f text;
  a1 text := $q$  if p_day->>'da_kind' = 'deputation' and te_dep_on(c.employee_id, (p_day->>'day')::date) is null then$q$;
begin
  f := pg_get_functiondef('public.te_save_day(uuid, jsonb)'::regprocedure);
  if position(a1 in f) = 0 then raise exception 'te_save_day changed'; end if;
  execute replace(f, a1, $q$  if p_day->>'da_kind' = 'aurum_per_diem' and coalesce((p_day->'hotel'->>'amount')::numeric, 0) > 0 then
    raise exception 'Per diem is paid only without a room stay. Choose Actual food, or remove the room';
  end if;
$q$ || a1);
end $$;

create or replace function public.te_set_rule(p_rule jsonb)
 returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  -- A page that does not know a field yet keeps what is there.
  select coalesce(to_jsonb(g), '{}'::jsonb) - 'updated_at' - 'updated_by' || p_rule into p_rule from (select 1) one left join te_grade_rules g on g.grade = p_rule->>'grade';
  p_rule := p_rule || jsonb_build_object('car_approval', coalesce((p_rule->>'car_approval')::boolean, false));
  insert into te_grade_rules select * from jsonb_populate_record(null::te_grade_rules, p_rule || jsonb_build_object('updated_at', now(), 'updated_by', current_employee_id()))
  on conflict (grade) do update set da_in_district = excluded.da_in_district, da_out_district = excluded.da_out_district,
    da_out_state = excluded.da_out_state, da_out_state_stay = excluded.da_out_state_stay,
    hotel_in_single = excluded.hotel_in_single, hotel_in_double = excluded.hotel_in_double,
    hotel_out_single = excluded.hotel_out_single, hotel_out_double = excluded.hotel_out_double, hotel_metro = excluded.hotel_metro,
    bike_rate = excluded.bike_rate, bike_km_month = excluded.bike_km_month, car_rate = excluded.car_rate, car_km_month = excluded.car_km_month,
    flight = excluded.flight, taxi = excluded.taxi, car_approval = excluded.car_approval,
    per_diem = excluded.per_diem, misc_day = excluded.misc_day, day_trip_metro = excluded.day_trip_metro, day_trip_other = excluded.day_trip_other,
    updated_at = now(), updated_by = current_employee_id();
end $function$;
