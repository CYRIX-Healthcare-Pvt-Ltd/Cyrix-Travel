/*
  te_0115 — Live counts people on each tile, with the number of claims, photos or bills under it (the user, 4 Nov:
  "change to people count in small font inside that show total claim").
*/
do $$
declare f text;
  a1 text := $q$'with_desk', (select count(*) from te_claims c join real r on r.id = c.employee_id where c.status = 'with_desk')),$q$;
begin
  f := pg_get_functiondef('public.te_usage(date, date)'::regprocedure);
  if position(a1 in f) = 0 then raise exception 'te_usage changed'; end if;
  f := replace(f, a1, $q$'with_desk', (select count(*) from te_claims c join real r on r.id = c.employee_id where c.status = 'with_desk')),
    'people_of', jsonb_build_object(
      'with_desk', (select count(distinct c.employee_id) from te_claims c join real r on r.id = c.employee_id where c.status = 'with_desk'))
      || coalesce((select jsonb_object_agg(k, n) from (select k, count(distinct id) n from hit group by k) z), '{}'),$q$);
  execute f;
end $$;
