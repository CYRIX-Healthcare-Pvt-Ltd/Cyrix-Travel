/*
  te_0070 — the calendar of "Add a claim" gives every kind of date its own colour (the user, 24 Oct: "all should be
  unique"; "A, keep legend"): a date in an approved or paid claim is green, one still waiting on an approver grey
  and struck through, one in a draft blue. te_my_claimed_days (te_0069) now says each date's claim status.
*/
create or replace function public.te_my_claimed_days()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(s.x order by s.x->>'day'), '[]'::jsonb) from (
    select jsonb_build_object('day', d.day, 'claim', k.id, 'name', coalesce(k.number, to_char(k.month, 'FMMon') || ' draft'),
             'draft', k.status in ('draft', 'returned', 'recalled'), 'status', k.status) as x
      from te_days d join te_claims k on k.id = d.claim_id
     where k.employee_id = current_employee_id()
    union all
    select jsonb_build_object('day', k.picked_day, 'claim', k.id, 'name', coalesce(k.number, to_char(k.month, 'FMMon') || ' draft'), 'draft', true, 'status', k.status)
      from te_claims k
     where k.employee_id = current_employee_id() and k.status in ('draft', 'returned', 'recalled') and k.picked_day is not null
       and not exists (select 1 from te_days d where d.claim_id = k.id)
  ) s
$function$;
