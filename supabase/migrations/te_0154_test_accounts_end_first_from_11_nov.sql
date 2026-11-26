/* te_0154 — for the test accounts, "End my day for … first" on a claim counts from 11 Nov too, as Start my day does
   since te_0151 (the user, 12 Nov: "for test account start from ysrtday"). Everybody else stays from end_first_from
   (12 Nov). One function decides it, used by Send (te_submit), the claim page's check before the confirm
   (te_claim_starts.end_first_from) and the open day (te_open_day). */
create or replace function public.te_end_first_from(p_emp uuid) returns date
 language sql stable security definer set search_path to 'public' as $$
  select case when te_is_test(p_emp)
              then least(coalesce(te_rule_from('end_first_from', p_emp), '2999-12-31'), date '2026-11-11')
              else te_rule_from('end_first_from', p_emp) end
$$;
revoke all on function public.te_end_first_from(uuid) from public, anon, authenticated;

do $$
declare f text; a text;
begin
  f := pg_get_functiondef('public.te_submit(uuid)'::regprocedure);
  a := $q$d.day >= coalesce(te_rule_from('end_first_from', c.employee_id), '2999-12-31')$q$;
  if position(a in f) = 0 then raise exception 'te_submit changed'; end if;
  execute replace(f, a, $q$d.day >= coalesce(te_end_first_from(c.employee_id), '2999-12-31')$q$);

  f := pg_get_functiondef('public.te_claim_starts(uuid)'::regprocedure);
  a := $q$'end_first_from', te_rule_from('end_first_from', c.employee_id),$q$;
  if position(a in f) = 0 then raise exception 'te_claim_starts changed'; end if;
  execute replace(f, a, $q$'end_first_from', te_end_first_from(c.employee_id),$q$);
end $$;

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
     and w.d >= coalesce(te_end_first_from(p_emp), '2999-12-31')
     and not exists (select 1 from te_day_ends e where e.employee_id = p_emp and e.day = w.d)
     and not exists (select 1 from te_day_starts s where s.employee_id = p_emp and s.day = t.today)
     and not exists (select 1 from te_visit_photos v where v.employee_id = p_emp and v.day = t.today)
$$;
revoke all on function public.te_open_day(uuid) from public, anon, authenticated;
