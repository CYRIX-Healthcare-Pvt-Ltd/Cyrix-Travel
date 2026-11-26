/*
  te_0171 — Km vs map: Map km is Google's quickest road, Claimed km the road the person picked (the user, 23 Nov: "map
  km is shortest or default when from and to, then claimed means he selected other than default"). A ride on another
  road keeps that road's km as its map km and Google's quickest in route_km; until now Extra compared the claim with
  the road picked, so another road never showed. Now Map km, Extra, Extra ₹ and the over-10% count all count from
  Google's quickest, here and in the Excel's rides.

  And per person how often another road was picked and how much longer (the user: "how much times and km and km %"):
  longer_n rides (the same rides as the "Other road picked" sign), longer_km over Google's road, quick_km (Google's
  road on those rides) for the %. The day's form, the "Km at the limit" sign and Most allowed km are unchanged.
*/
do $$
declare f text;
begin
  f := pg_get_functiondef('public.te_km_report(date, date, uuid, boolean)'::regprocedure);
  if position($q$sum(map_km) filter (where checked) as map_km,$q$ in f) = 0
     or position($q$sum(amount * (claimed_km - map_km) / nullif(claimed_km, 0)) filter (where checked and claimed_km > map_km) as extra_amount,$q$ in f) = 0
     or position($q$count(*) filter (where checked and claimed_km > map_km * 1.1) as over10$q$ in f) = 0
     or position($q$  ), fc as ($q$ in f) = 0
     or position($q$left join kmp k on k.employee_id = e.id$q$ in f) = 0
     or position($q$'cut', coalesce((select round(c.amount) from fc c where c.employee_id = e.id and c.kind = 'cut'), 0)$q$ in f) = 0
     or position($q$'map_km', k.map_km, 'claimed_km', k.claimed_km, 'top'$q$ in f) = 0
     or position($q$'map_km', r.map_km, 'claimed_km', r.claimed_km, 'top'$q$ in f) = 0 then raise exception 'te_km_report changed'; end if;

  -- Map km is Google's quickest.
  f := replace(f, $q$sum(map_km) filter (where checked) as map_km,$q$, $q$sum(coalesce(route_km, map_km)) filter (where checked) as map_km,$q$);
  f := replace(f, $q$sum(amount * (claimed_km - map_km) / nullif(claimed_km, 0)) filter (where checked and claimed_km > map_km) as extra_amount,$q$,
    $q$sum(amount * (claimed_km - coalesce(route_km, map_km)) / nullif(claimed_km, 0)) filter (where checked and claimed_km > coalesce(route_km, map_km)) as extra_amount,$q$);
  f := replace(f, $q$count(*) filter (where checked and claimed_km > map_km * 1.1) as over10$q$,
    $q$count(*) filter (where checked and claimed_km > coalesce(route_km, map_km) * 1.1) as over10$q$);
  f := replace(f, $q$'map_km', k.map_km, 'claimed_km', k.claimed_km, 'top'$q$, $q$'map_km', coalesce(k.route_km, k.map_km), 'claimed_km', k.claimed_km, 'top'$q$);
  f := replace(f, $q$'map_km', r.map_km, 'claimed_km', r.claimed_km, 'top'$q$, $q$'map_km', coalesce(r.route_km, r.map_km), 'claimed_km', r.claimed_km, 'top'$q$);

  -- Another road over Google's quickest, per person.
  f := replace(f, $q$  ), fc as ($q$, $q$  ), lr as (
    -- The rides of the "Other road picked" sign.
    select employee_id, count(*) as n, sum(map_km - route_km) as km, sum(route_km) as quick
    from rr where route_km is not null and map_km > route_km + 0.05 group by employee_id
  ), fc as ($q$);
  f := replace(f, $q$left join kmp k on k.employee_id = e.id$q$, $q$left join kmp k on k.employee_id = e.id left join lr l on l.employee_id = e.id$q$);
  f := replace(f, $q$'cut', coalesce((select round(c.amount) from fc c where c.employee_id = e.id and c.kind = 'cut'), 0)$q$,
    $q$'cut', coalesce((select round(c.amount) from fc c where c.employee_id = e.id and c.kind = 'cut'), 0),
        'longer_n', coalesce(l.n, 0), 'longer_km', round(coalesce(l.km, 0), 1), 'quick_km', round(coalesce(l.quick, 0), 1)$q$);
  execute f;
end $$;
