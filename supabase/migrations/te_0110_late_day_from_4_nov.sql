/*
  te_0110 — late night work and End my day from 4 Nov's trips (the user, 4 Nov: "from todays claim only end my day and
  visit on 4th should come ok, when they opens today dont show"): the day before is offered after midnight only when it
  is on or after day_start_from, so 3 Nov, before Start my day, never is; and a day not ended is said from 4 Nov.
*/
update public.te_policy set value = to_jsonb('2026-11-04'::text) where key = 'day_end_from';

create or replace function public.te_late_day(p_emp uuid) returns date
 language sql stable security definer set search_path to 'public' as $$
  select y from (select (now() at time zone 'Asia/Kolkata')::date - 1 as y, (now() at time zone 'Asia/Kolkata')::date as t) d
   where d.y >= coalesce(te_rule_from('day_start_from', p_emp), '2999-12-31')
     and (exists (select 1 from te_day_starts s where s.employee_id = p_emp and s.day = d.y)
          or exists (select 1 from te_visit_photos v where v.employee_id = p_emp and v.day = d.y))
     and not exists (select 1 from te_day_ends e where e.employee_id = p_emp and e.day = d.y)
     and not exists (select 1 from te_day_starts s where s.employee_id = p_emp and s.day = d.t)
     and not exists (select 1 from te_visit_photos v where v.employee_id = p_emp and v.day = d.t)
$$;
revoke all on function public.te_late_day(uuid) from public, anon, authenticated;
