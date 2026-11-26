/*
  te_0087 — a Travel admin or the SW Admin adds a place to the search themselves (the user, 30 Oct: "why there is no
  option for sw admin to add place?"): named, and put on the map by a press, a search or a pasted link, as a learned
  place is put right. It is checked as it is added. The same name within half a kilometre is refused: that place is
  put right instead.
*/
create or replace function public.te_admin_add_place(p_name text, p_lat double precision, p_lng double precision)
 returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare
  me     uuid := current_employee_id();
  nm     text := btrim(coalesce(p_name, ''));
  ws     text[];
  kd     text;
  twin   text;
  new_id uuid;
begin
  if not (te_is_admin() or is_sw_admin()) then raise exception 'Only a Travel admin adds a place'; end if;
  if length(nm) < 2 then raise exception 'Give the place a name'; end if;
  if length(nm) > 200 then raise exception 'Keep the name under 200 characters'; end if;
  if not travel_point_ok(p_lat, p_lng) then raise exception 'Put the pin on the map'; end if;
  ws := te_place_words(nm); kd := te_place_type(nm);
  select f.name into twin from te_facilities f
   where not f.hidden and f.words = ws and f.kind is not distinct from kd and te_km(f.lat, f.lng, p_lat, p_lng) < 0.5
   order by te_km(f.lat, f.lng, p_lat, p_lng) limit 1;
  if twin is not null then raise exception '% is already there — put its name or pin right instead', twin; end if;
  insert into te_facilities (name, full_name, words, area, kind, lat, lng, district, first_by, source, checked_at, checked_by)
  values (nm, nm, ws, '{}', kd, p_lat, p_lng, null, me, 'admin', now(), me)
  returning id into new_id;
  return new_id;
end $function$;
revoke all on function public.te_admin_add_place(text, double precision, double precision) from public, anon;
grant execute on function public.te_admin_add_place(text, double precision, double precision) to authenticated, service_role;
