/* te_0151 — the test accounts' open day counts from 11 Nov (everybody else from end_first_from, 12 Nov), so a day
   started yesterday can be tried today (the user, 12 Nov: "start a day yesterday"). Applied 12 Nov. */
create or replace function public.te_open_day(p_emp uuid) returns date
 language sql stable security definer set search_path to 'public' as $$
  with t as (select (now() at time zone 'Asia/Kolkata')::date as today),
  w as (
    select max(x.day) d from (
      select s.day from te_day_starts s, t where s.employee_id = p_emp and s.day < t.today
      union all
      select v.day from te_visit_photos v, t where v.employee_id = p_emp and v.day < t.today) x)
  select w.d from w, t
   where w.d is not null
     and w.d >= case when te_is_test(p_emp) then least(coalesce(te_rule_from('end_first_from', p_emp), '2999-12-31'), date '2026-11-11')
                     else coalesce(te_rule_from('end_first_from', p_emp), '2999-12-31') end
     and not exists (select 1 from te_day_ends e where e.employee_id = p_emp and e.day = w.d)
     and not exists (select 1 from te_day_starts s where s.employee_id = p_emp and s.day = t.today)
     and not exists (select 1 from te_visit_photos v where v.employee_id = p_emp and v.day = t.today)
$$;
revoke all on function public.te_open_day(uuid) from public, anon, authenticated;

