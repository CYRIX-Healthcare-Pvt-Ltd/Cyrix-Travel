/*
  te_0106 — tomorrow's rules a day early for the test accounts (the user, 3 Nov: "enable that start my day in all test
  accounts, and all things which we planned 2mrw, activate for test accounts"): home first (te_0102) and Start my day
  (te_0104) are asked of E6666, E7777, E8888, E9999 and "- Test" names from today; everyone else from the policy date.
*/
create or replace function public.te_is_test(p_emp uuid) returns boolean
 language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from employees e where e.id = p_emp
                  and (upper(e.ecode) in ('E6666', 'E7777', 'E8888', 'E9999') or e.full_name ilike '%- test%'))
$$;
revoke all on function public.te_is_test(uuid) from public, anon;
grant execute on function public.te_is_test(uuid) to authenticated;

-- The day a rule in te_policy starts for this person: the test accounts have it from today.
create or replace function public.te_rule_from(p_key text, p_emp uuid) returns date
 language sql stable security definer set search_path to 'public' as $$
  select case when te_is_test(p_emp)
              then least(coalesce(nullif(te_pol(p_key) #>> '{}', '')::date, '2999-12-31'), (now() at time zone 'Asia/Kolkata')::date)
              else nullif(te_pol(p_key) #>> '{}', '')::date end
$$;
revoke all on function public.te_rule_from(text, uuid) from public, anon;
grant execute on function public.te_rule_from(text, uuid) to authenticated;

create or replace function public.te_home_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
  since date;
begin
  since := te_rule_from('home_required_from', case tg_table_name when 'te_claims' then (to_jsonb(new) ->> 'employee_id')::uuid
    else (select c.employee_id from te_claims c where c.id = (to_jsonb(new) ->> 'claim_id')::uuid) end);
  if since is null or (now() at time zone 'Asia/Kolkata')::date < since then return new; end if;
  owner := case tg_table_name when 'te_claims' then (to_jsonb(new) ->> 'employee_id')::uuid
    else (select c.employee_id from te_claims c where c.id = (to_jsonb(new) ->> 'claim_id')::uuid) end;
  if owner is distinct from current_employee_id() then return new; end if;
  if not exists (select 1 from travel_homes h where h.employee_id = owner) then
    raise exception 'Set your home in My profile first — every claim starts from it';
  end if;
  return new;
end $$;

create or replace function public.te_home_needed()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(te_rule_from('home_required_from', current_employee_id()) <= (now() at time zone 'Asia/Kolkata')::date, false)
    and not exists (select 1 from travel_homes h where h.employee_id = current_employee_id())
$$;

create or replace function public.te_my_day()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'required', coalesce(te_rule_from('day_start_from', current_employee_id()) <= (now() at time zone 'Asia/Kolkata')::date, false),
    'start', (select jsonb_build_object('at', s.at, 'lat', s.lat, 'lng', s.lng, 'place', s.place,
                'home_m', (select round(te_m(h.lat, h.lng, s.lat, s.lng)) from travel_homes h where h.employee_id = s.employee_id))
              from te_day_starts s where s.employee_id = current_employee_id() and s.day = (now() at time zone 'Asia/Kolkata')::date))
$$;

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
      from te_day_starts s where s.employee_id = c.employee_id and s.day >= c.month and s.day < (c.month + interval '1 month')::date), '[]'));
end $$;
