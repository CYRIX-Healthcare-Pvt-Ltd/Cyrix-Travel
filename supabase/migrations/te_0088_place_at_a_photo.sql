/*
  te_0088 — a ride's From or To chosen from the day's visit photos (the user, 30 Oct: "if i select dh aluva's image
  then it should automatically fetch location"): the place we know where the photo was taken, the nearest learned
  place within 200 m, so it reads as the map's list has it. None, and the person names the spot, as a pressed one.
*/
create or replace function public.te_place_at(p_lat float8, p_lng float8, p_m int default 200) returns text
 language sql stable security definer set search_path to 'public' as $$
  select f.name from te_facilities f
   where not coalesce(f.hidden, false) and te_m(p_lat, p_lng, f.lat, f.lng) <= least(greatest(coalesce(p_m, 200), 10), 500)
   order by te_m(p_lat, p_lng, f.lat, f.lng) limit 1
$$;
revoke all on function public.te_place_at(float8, float8, int) from public, anon;
grant execute on function public.te_place_at(float8, float8, int) to authenticated, service_role;
