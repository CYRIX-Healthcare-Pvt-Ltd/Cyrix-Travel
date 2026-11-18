/*
  te_0166 — The longer-road rules as Settings (the user, 18 Nov: "update the setting, and make it clean, ie if anything
  not used remove it"). road_pct: % over Google's own road that asks "Why this road?", and the % added to the longest
  road shown from road_pct_from_km on; road_extra_km: km added to the longest road shown. Bike and car two-way limit km
  are read by nothing and go.
*/
insert into public.te_policy (key, value) values ('road_pct', '10'), ('road_pct_from_km', '30'), ('road_extra_km', '3')
on conflict (key) do nothing;
delete from public.te_policy where key in ('bike_two_way_km', 'car_two_way_km');

do $$
declare f text;
  a text := $q$  if p_key = 'km_band_km' and$q$;
begin
  f := pg_get_functiondef('public.te_set_policy(text, jsonb)'::regprocedure);
  if position(a in f) = 0 then raise exception 'te_set_policy changed'; end if;
  f := replace(f, a, $q$  if p_key = 'road_pct' and (jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric not between 0 and 100) then
    raise exception 'Give a percent from 0 to 100';
  end if;
  if p_key = 'road_pct_from_km' and (jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric not between 0 and 500) then
    raise exception 'Give the km from 0 to 500';
  end if;
  if p_key = 'road_extra_km' and (jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric not between 0 and 50) then
    raise exception 'Give the km from 0 to 50';
  end if;
$q$ || a);
  execute f;
end $$;
