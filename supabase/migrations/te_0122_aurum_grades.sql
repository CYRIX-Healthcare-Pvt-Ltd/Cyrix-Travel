/*
  te_0122 — Aurum's rules, Part 1 (the user, 4 Nov: "we have different policy for Aurum function teams"; the Aurum
  Local Conveyance and Domestic Travel policies, V2/2026). Aurum people carry their Blue Star band as the grade —
  E1 to E6 — and none of Cyrix's own grades start with E, so the rows below reach Aurum and nobody else.

  Local conveyance:
    bike ₹7/km, car ₹13/km (toll and parking at actual, as other expenses), no monthly km limit;
    E1–E3 a car or a taxi needs the reporting manager's approval (a vehicle request), E4–E6 have both.
  Hotel (before tax): E1–E2 ₹5,000 metro / ₹3,500 non-metro, E3–E4 ₹8,000 / ₹6,500, E5–E6 ₹10,000 / ₹8,000.
  Air economy for every band. DA is nought here: Aurum's local travel has none, and outstation is per diem (Part 2).
*/
alter table public.te_grade_rules add column if not exists car_approval boolean not null default false;
alter table public.te_grade_rules add column if not exists hotel_metro numeric;
comment on column public.te_grade_rules.car_approval is 'The car is paid at car_rate but needs a vehicle request first (Aurum E1–E3).';
comment on column public.te_grade_rules.hotel_metro is 'The room limit in a metro city; when empty, the out-of-state limit plus metro_extra_pct.';

insert into public.te_grade_rules (grade, da_in_district, da_out_district, da_out_state, da_out_state_stay,
  hotel_in_single, hotel_in_double, hotel_out_single, hotel_out_double, hotel_metro,
  bike_rate, bike_km_month, car_rate, car_km_month, flight, taxi, car_approval)
values
  ('E1', 0, 0, 0, 0, 3500, 3500, 3500, 3500, 5000,  7, null, 13, null, true, false, true),
  ('E2', 0, 0, 0, 0, 3500, 3500, 3500, 3500, 5000,  7, null, 13, null, true, false, true),
  ('E3', 0, 0, 0, 0, 6500, 6500, 6500, 6500, 8000,  7, null, 13, null, true, false, true),
  ('E4', 0, 0, 0, 0, 6500, 6500, 6500, 6500, 8000,  7, null, 13, null, true, true,  false),
  ('E5', 0, 0, 0, 0, 8000, 8000, 8000, 8000, 10000, 7, null, 13, null, true, true,  false),
  ('E6', 0, 0, 0, 0, 8000, 8000, 8000, 8000, 10000, 7, null, 13, null, true, true,  false)
on conflict (grade) do nothing;

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
    flight = excluded.flight, taxi = excluded.taxi, car_approval = excluded.car_approval, updated_at = now(), updated_by = current_employee_id();
end $function$;

-- A car the grade pays but only with approval is asked for like one it does not give.
create or replace function public.te_va_modes(p_employee uuid)
 returns text[] language sql stable security definer set search_path to 'public' as $function$
  select array_remove(array[
    case when r.car_rate is null or coalesce(r.car_approval, false) then 'car' end, case when r.bike_rate is null then 'bike' end,
    case when not coalesce(r.taxi, false) then 'taxi' end, case when not coalesce(r.flight, false) then 'flight' end], null)
  from employees e cross join lateral te_rule(e.grade) r where e.id = p_employee
$function$;
