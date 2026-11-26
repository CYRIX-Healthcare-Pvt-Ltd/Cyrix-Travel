/*
  te_0116 — Live: "With manager" in place of the bills tile (the user, 4 Nov: "remove added bill and add with manager"):
  claims with the reporting manager now, and how many people they belong to.
*/
do $$
declare f text;
  a1 text := $q$'with_desk', (select count(*) from te_claims c join real r on r.id = c.employee_id where c.status = 'with_desk')),$q$;
  a2 text := $q$'with_desk', (select count(distinct c.employee_id) from te_claims c join real r on r.id = c.employee_id where c.status = 'with_desk'))$q$;
begin
  f := pg_get_functiondef('public.te_usage(date, date)'::regprocedure);
  if position(a1 in f) = 0 or position(a2 in f) = 0 then raise exception 'te_usage changed'; end if;
  f := replace(f, a1, $q$'with_desk', (select count(*) from te_claims c join real r on r.id = c.employee_id where c.status = 'with_desk'),
      'with_manager', (select count(*) from te_claims c join real r on r.id = c.employee_id where c.status = 'with_manager')),$q$);
  f := replace(f, a2, $q$'with_desk', (select count(distinct c.employee_id) from te_claims c join real r on r.id = c.employee_id where c.status = 'with_desk'),
      'with_manager', (select count(distinct c.employee_id) from te_claims c join real r on r.id = c.employee_id where c.status = 'with_manager'))$q$);
  execute f;
end $$;
