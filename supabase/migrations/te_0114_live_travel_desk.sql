/*
  te_0114 — Live shows the Travel Desk (the user, 4 Nov: "can we see with travel desk?"): claims approved by the Travel
  Desk in the dates, and claims with the Travel Desk now. Real people only, as the rest of Live.
*/
do $$
declare f text;
  a1 text := $q$where ev.action in ('submitted', 'resubmitted', 'manager_approved')$q$;
  a2 text := $q$'vehicles', (select count(*) from hit where k = 'vehicle')),$q$;
begin
  f := pg_get_functiondef('public.te_usage(date, date)'::regprocedure);
  if position(a1 in f) = 0 or position(a2 in f) = 0 then raise exception 'te_usage changed'; end if;
  f := replace(f, a1, a1 || $q$
    union all select c.employee_id, 'desk', ev.at from te_events ev join te_claims c on c.id = ev.claim_id where ev.action = 'desk_approved'$q$);
  f := replace(f, a2, $q$'vehicles', (select count(*) from hit where k = 'vehicle'),
      'desk', (select count(*) from hit where k = 'desk'),
      'with_desk', (select count(*) from te_claims c join real r on r.id = c.employee_id where c.status = 'with_desk')),$q$);
  execute f;
end $$;
