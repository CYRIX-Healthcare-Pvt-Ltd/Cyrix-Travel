/*
  te_0011 — a trip says when it ended at the engineer's home.

  A day that ends at home ends with End trip, and its last ride read
  "GH Thrissur → End of trip" (the user, 2 Oct, back from a visit by auto:
  "what if return to home or last destination to close the trip?"). Where
  the trip ended is on it as a point; that the point is the engineer's home
  was nowhere, and a manager cannot read an engineer's home to work it out.

  travel_end now writes it down: ended within 300 m of the saved home — the
  same reach a facility's place and a saved place have — the trip is marked
  ended_home, and the ride that ended it reads "→ Home" on both screens. It
  is the home as it stood when the trip ended; moving home later does not
  rewrite an old claim.

  Trips already ended are marked by the same rule, against the home saved
  now. Nothing is paid differently: the mark only names a place.
*/

alter table public.travel_trips add column if not exists ended_home boolean not null default false;
comment on column public.travel_trips.ended_home is 'The trip was ended within 300 m of the engineer''s saved home (te_0011). Names the end of the last ride; pays nothing.';

update public.travel_trips t set ended_home = true
  from public.travel_homes h
 where h.employee_id = t.employee_id and t.ended_at is not null and t.end_lat is not null
   and public.travel_line_km(h.lat, h.lng, t.end_lat, t.end_lng) <= 0.3;

CREATE OR REPLACE FUNCTION public.travel_end(p_trip_id uuid, p_lat double precision, p_lng double precision, p_road_km numeric DEFAULT NULL::numeric, p_fare numeric DEFAULT NULL::numeric, p_bill_path text DEFAULT NULL::text, p_bill_lat double precision DEFAULT NULL::double precision, p_bill_lng double precision DEFAULT NULL::double precision)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t travel_trips := travel_mine_running(p_trip_id);
begin
  if not travel_point_ok(p_lat, p_lng) then raise exception 'Your location could not be read — allow location and try again'; end if;
  if exists (select 1 from travel_stops where trip_id = t.id and closed_at is null) then
    raise exception 'Close the stop you are at, with its photograph, before ending the trip';
  end if;
  -- A leg is running unless the trip is being ended where a stop was closed; then there is none to close.
  if exists (select 1 from travel_legs where trip_id = t.id and to_at is null) then
    perform travel_close_leg(t, p_lat, p_lng, p_road_km, p_fare, p_bill_path, p_bill_lat, p_bill_lng);
  end if;
  -- Ended within 300 m of the engineer's saved home, the trip says so: its last ride reads "→ Home", to them and to the manager.
  update travel_trips set end_lat = p_lat, end_lng = p_lng, ended_at = now(),
    ended_home = exists (select 1 from travel_homes h where h.employee_id = t.employee_id and travel_line_km(h.lat, h.lng, p_lat, p_lng) <= 0.3)
  where id = t.id;
end $function$;
