/*
  te_0112 — SW Admin → Travel Expense → Reports → Km vs map: each ride carries its From and To points, so it opens on
  the map (the user, 4 Nov: "need to show base location in map also just to verify it").
*/
do $$
declare f text;
  was text := $q$'top', case when k.checked then k.top end, 'amount', k.amount$q$;
begin
  f := pg_get_functiondef('public.te_km_report'::regproc);
  if position(was in f) = 0 then raise exception 'te_km_report changed'; end if;
  execute replace(f, was, was || $q$,
        'from_lat', k.from_lat, 'from_lng', k.from_lng, 'to_lat', k.to_lat, 'to_lng', k.to_lng$q$);
end $$;
