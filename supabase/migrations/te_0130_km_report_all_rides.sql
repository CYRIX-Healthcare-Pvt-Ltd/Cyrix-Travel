/*
  te_0130 — Km vs map's person page lists every ride of the day, auto, bus and train too, so its day map shows the
  whole day (the user, 5 Nov: "and ride only bike, but why auto?" then "yes show all rides"). A new key, all_rides,
  beside rides (bike and car, unchanged for Travel's Reports tab and the Excel): only with p_detail.
*/
do $$
declare f text; was text; now_ text;
begin
  f := replace(pg_get_functiondef('public.te_km_report(date,date,uuid,boolean)'::regprocedure), E'\r\n', E'\n');
  was := $w$    'signs', case when p_detail then coalesce((select jsonb_agg(jsonb_build_object($w$;
  now_ := $n$    'all_rides', case when p_detail then coalesce((select jsonb_agg(jsonb_build_object(
        'employee_id', r.employee_id, 'day', r.day, 'number', r.number, 'way', r.way, 'mode', r.mode, 'purpose', r.purpose, 'project', r.project,
        'map_km', r.map_km, 'claimed_km', r.claimed_km, 'top', case when k.checked then k.top end, 'amount', r.amount, 'fare', r.fare,
        'from_lat', r.from_lat, 'from_lng', r.from_lng, 'to_lat', r.to_lat, 'to_lng', r.to_lng
      ) order by r.employee_id, r.day, r.seq) from rr r left join km k on k.id = r.id), '[]'::jsonb) end,
$n$ || was;
  if position(was in f) = 0 then raise exception 'te_km_report changed'; end if;
  if position('''all_rides''' in f) > 0 then return; end if;
  execute replace(f, was, now_);
end $$;
