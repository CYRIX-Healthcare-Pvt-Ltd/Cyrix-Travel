/*
  te_0120 — Live's people table shows "photo not possible" used (the user, 4 Nov: "need visit photo limit used"):
  rides marked photo not possible on days within the chosen dates, and the month's limit.
*/
do $$
declare f text;
  a1 text := $q$'vehicles', (select count(*) from hit h where h.id = p.id and h.k = 'vehicle'))$q$;
  a2 text := $q$'at', now())$q$;
begin
  f := pg_get_functiondef('public.te_usage(date, date)'::regprocedure);
  if position(a1 in f) = 0 or position(a2 in f) = 0 then raise exception 'te_usage changed'; end if;
  f := replace(f, a1, $q$'vehicles', (select count(*) from hit h where h.id = p.id and h.k = 'vehicle'),
      'skips', (select count(*) from te_rides r join te_days d on d.id = r.day_id join te_claims c on c.id = d.claim_id
        where c.employee_id = p.id and r.photo_skip is not null and d.day >= coalesce(p_from, '-infinity'::date) and d.day <= coalesce(p_to, 'infinity'::date)))$q$);
  f := replace(f, a2, $q$'skip_limit', (te_pol('photo_skips'))::text::int, 'at', now())$q$);
  execute f;
end $$;
