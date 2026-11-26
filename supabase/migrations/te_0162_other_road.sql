/*
  te_0162 — Another of Google's roads picked (the user, 18 Nov: "if the km matches and in sw admin, we need to knw that
  the person always using alternate routes to increase the km"). A ride whose engineer picked a road other than
  Google's own keeps Google's road km in route_km (empty when Google's road was kept). SW Admin's Km vs map shows each
  such ride as a sign, "Other road picked", with both km, even when the km claimed matches the map.
*/
alter table public.te_rides add column if not exists route_km numeric;

do $$
declare f text;
begin
  f := pg_get_functiondef((select p.oid from pg_proc p where p.proname = 'te_save_day'));
  if position($q$project, photo_skip, commute)$q$ in f) = 0
     or position($q$nullif(btrim(x->>'photo_skip'), ''), coalesce(com, false))$q$ in f) = 0
     or position($q$commute = excluded.commute;$q$ in f) = 0 then raise exception 'te_save_day changed'; end if;
  f := replace(f, $q$project, photo_skip, commute)$q$, $q$project, photo_skip, commute, route_km)$q$);
  f := replace(f, $q$nullif(btrim(x->>'photo_skip'), ''), coalesce(com, false))$q$,
    $q$nullif(btrim(x->>'photo_skip'), ''), coalesce(com, false), nullif(x->>'route_km', '')::numeric)$q$);
  f := replace(f, $q$commute = excluded.commute;$q$, $q$commute = excluded.commute, route_km = excluded.route_km;$q$);
  execute f;

  f := pg_get_functiondef('public.te_km_report(date, date, uuid, boolean)'::regprocedure);
  if position($q$r.purpose, r.project, r.photo_skip, dd.day$q$ in f) = 0
     or position($q$    select k.employee_id, k.day, 'no_map'$q$ in f) = 0 then raise exception 'te_km_report changed'; end if;
  f := replace(f, $q$r.purpose, r.project, r.photo_skip, dd.day$q$, $q$r.purpose, r.project, r.photo_skip, r.route_km, dd.day$q$);
  f := replace(f, $q$    select k.employee_id, k.day, 'no_map'$q$, $q$    select r.employee_id, r.day, 'other_road',
      format('%s — another road, %s km; Google''s road %s km', r.way, round(r.map_km, 1), round(r.route_km, 1)), null
    from rr r where r.route_km is not null and r.map_km > r.route_km + 0.05
    union all
    select k.employee_id, k.day, 'no_map'$q$);
  execute f;
end $$;
