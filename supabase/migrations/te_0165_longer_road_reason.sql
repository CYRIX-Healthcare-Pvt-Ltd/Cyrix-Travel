/*
  te_0165 — A longer road needs its reason (the user, 18 Nov: "ask reason"). A ride on another of Google's roads more
  than the km tolerance (10%) longer than Google's own road is saved only with why (route_why): the manager and the
  Travel Desk read it on the ride, and SW Admin's "Other road picked" sign carries it.
*/
alter table public.te_rides add column if not exists route_why text;

do $$
declare f text;
begin
  f := pg_get_functiondef((select p.oid from pg_proc p where p.proname = 'te_save_day'));
  if position($q$commute, route_km, route_alts)$q$ in f) = 0
     or position($q$case when jsonb_typeof(x->'route_alts') = 'object' then x->'route_alts' end)$q$ in f) = 0
     or position($q$route_alts = excluded.route_alts;$q$ in f) = 0 then raise exception 'te_save_day changed'; end if;
  f := replace(f, $q$commute, route_km, route_alts)$q$, $q$commute, route_km, route_alts, route_why)$q$);
  f := replace(f, $q$case when jsonb_typeof(x->'route_alts') = 'object' then x->'route_alts' end)$q$,
    $q$case when jsonb_typeof(x->'route_alts') = 'object' then x->'route_alts' end, nullif(btrim(x->>'route_why'), ''))$q$);
  f := replace(f, $q$route_alts = excluded.route_alts;$q$, $q$route_alts = excluded.route_alts, route_why = excluded.route_why;$q$);
  execute f;

  f := pg_get_functiondef('public.te_km_report(date, date, uuid, boolean)'::regprocedure);
  if position($q$r.photo_skip, r.route_km, dd.day$q$ in f) = 0
     or position($q$format('%s — another road, %s km; Google''s road %s km', r.way, round(r.map_km, 1), round(r.route_km, 1))$q$ in f) = 0 then raise exception 'te_km_report changed'; end if;
  f := replace(f, $q$r.photo_skip, r.route_km, dd.day$q$, $q$r.photo_skip, r.route_km, r.route_why, dd.day$q$);
  f := replace(f, $q$format('%s — another road, %s km; Google''s road %s km', r.way, round(r.map_km, 1), round(r.route_km, 1))$q$,
    $q$format('%s — another road, %s km; Google''s road %s km%s', r.way, round(r.map_km, 1), round(r.route_km, 1), coalesce(' · “' || r.route_why || '”', ''))$q$);
  execute f;
end $$;
