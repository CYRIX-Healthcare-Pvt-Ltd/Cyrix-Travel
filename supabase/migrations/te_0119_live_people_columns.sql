/*
  te_0119 — Live's people table has the tiles' columns (the user, 4 Nov: "here, same things in grid"): with manager and
  with the Travel Desk (sent within the dates), Travel Desk approved, advances, deputations and vehicle requests.
*/
do $$
declare f text;
  a1 text := $q$'photos', p.photos, 'bills', p.bills, 'home', p.home, 'new', p.new)$q$;
  last text := $q$(select max(l.at) from te_events l where l.claim_id = c.id and l.action in ('submitted', 'resubmitted'))$q$;
begin
  f := pg_get_functiondef('public.te_usage(date, date)'::regprocedure);
  if position(a1 in f) = 0 then raise exception 'te_usage changed'; end if;
  f := replace(f, a1, $q$'photos', p.photos, 'bills', p.bills, 'home', p.home, 'new', p.new,
      'with_manager', (select count(*) from te_claims c where c.employee_id = p.id and c.status = 'with_manager' and $q$ || last || $q$ >= s and $q$ || last || $q$ < e),
      'with_desk', (select count(*) from te_claims c where c.employee_id = p.id and c.status = 'with_desk' and $q$ || last || $q$ >= s and $q$ || last || $q$ < e),
      'desk', (select count(*) from hit h where h.id = p.id and h.k = 'desk'),
      'homes', (select count(*) from hit h where h.id = p.id and h.k = 'home'),
      'advances', (select count(*) from hit h where h.id = p.id and h.k = 'advance'),
      'deputations', (select count(*) from hit h where h.id = p.id and h.k = 'deputation'),
      'vehicles', (select count(*) from hit h where h.id = p.id and h.k = 'vehicle'))$q$);
  execute f;
end $$;
