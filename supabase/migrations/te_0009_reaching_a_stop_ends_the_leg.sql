/*
  te_0009 — reaching a stop ends the leg, and the engineer sets off again after it.

  A leg ran from one change of mode to the next, straight through any stop
  made on it: an engineer who drove to a hospital, did the visit and closed
  it was still "on car" as far as the trip knew (the user, 2 Oct: "im on
  car, so i reached, so the car trip also should end isnt? … so reached
  means now he is not in vehicle isnt? so after activity he can start again
  isnt?"). te_0004 made the distance come out right by measuring through the
  stops, but the record stayed one long leg with a visit inside it — and a
  bus there and a bus back were one fare and one bill.

  A leg is now a journey from one place to the next:

    - "I am here" ends the leg that brought the engineer there. It is
      measured to that point and paid — and a bus, train or auto ride is
      given its fare and its bill then, as the ride it was.
    - While the stop is open, and after it is closed, nothing is
      travelling: the engineer is at the place.
    - Setting off again (travel_resume) starts the next leg from where the
      phone is then, by the mode chosen.
    - End trip closes the leg that is running; a trip ended at the place of
      its last stop has none, and simply ends.

  travel_reach gains arguments, so it is dropped and made again and who may
  call it is restated. The new arguments have defaults, so the app as it is
  deployed today goes on calling it.

  A trip already on the road with a stop inside its leg goes on as it was:
  its leg is still running until the next place is reached or the mode is
  changed, and it is measured through that stop as te_0004 has it.
*/
drop function public.travel_reach(uuid, text, text, text, double precision, double precision, text);

CREATE FUNCTION public.travel_reach(p_trip_id uuid, p_kind text, p_facility text, p_ticket_no text, p_lat double precision, p_lng double precision, p_note text DEFAULT NULL::text,
  p_road_km numeric DEFAULT NULL::numeric, p_fare numeric DEFAULT NULL::numeric, p_bill_path text DEFAULT NULL::text,
  p_bill_lat double precision DEFAULT NULL::double precision, p_bill_lng double precision DEFAULT NULL::double precision)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t   travel_trips := travel_mine_running(p_trip_id);
  fac text := btrim(coalesce(p_facility, ''));
  tk  text := nullif(btrim(coalesce(p_ticket_no, '')), '');
  key text;
  f   travel_facilities;
  sid uuid;
begin
  if p_kind not in ('ticket', 'pm', 'meeting', 'spare') then raise exception 'Choose what this stop is for'; end if;
  if length(fac) < 2 then raise exception 'Enter the facility, or the place, you have reached'; end if;
  if p_kind = 'ticket' and tk is null then raise exception 'Enter the ticket ID you came for'; end if;
  if not travel_point_ok(p_lat, p_lng) then raise exception 'Your location could not be read — allow location and try again'; end if;
  if exists (select 1 from travel_stops where trip_id = t.id and closed_at is null) then
    raise exception 'Close the stop you are at before reaching another';
  end if;
  -- Reaching a place ends the leg that brought the engineer to it: measured to here, and paid — on its fare, with
  -- its bill, if it is a fare-paid mode. Closed before the stop is put in, so the stop is its end and not a place on its way.
  if exists (select 1 from travel_legs where trip_id = t.id and to_at is null) then
    perform travel_close_leg(t, p_lat, p_lng, p_road_km, p_fare, p_bill_path, p_bill_lat, p_bill_lng);
  end if;
  key := lower(regexp_replace(fac, '[^a-zA-Z0-9]+', '', 'g'));
  select * into f from travel_facilities where name_key = key;
  insert into travel_stops (trip_id, seq, kind, ticket_no, facility_name, facility_id, lat, lng, note)
  values (t.id, (select coalesce(max(seq), 0) + 1 from travel_stops where trip_id = t.id), p_kind, tk, fac, f.id, p_lat, p_lng,
          nullif(btrim(coalesce(p_note, '')), ''))
  returning id into sid;
  return sid;
end $function$;

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
  update travel_trips set end_lat = p_lat, end_lng = p_lng, ended_at = now() where id = t.id;
end $function$;

/** After a stop: the engineer sets off again, from where they are now, by the mode they choose. */
create or replace function public.travel_resume(p_trip_id uuid, p_lat double precision, p_lng double precision, p_mode text)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare t travel_trips := travel_mine_running(p_trip_id);
begin
  if not travel_point_ok(p_lat, p_lng) then raise exception 'Your location could not be read — allow location and try again'; end if;
  if not exists (select 1 from travel_modes where mode = p_mode and is_active) then raise exception 'Choose how you are travelling next'; end if;
  if exists (select 1 from travel_stops where trip_id = t.id and closed_at is null) then
    raise exception 'Close the stop you are at before setting off again';
  end if;
  if exists (select 1 from travel_legs where trip_id = t.id and to_at is null) then raise exception 'You are already travelling'; end if;
  insert into travel_legs (trip_id, seq, mode, from_lat, from_lng)
  values (t.id, (select coalesce(max(seq), 0) + 1 from travel_legs where trip_id = t.id), p_mode, p_lat, p_lng);
end $fn$;

revoke all on function public.travel_reach(uuid, text, text, text, double precision, double precision, text, numeric, numeric, text, double precision, double precision) from public, anon;
revoke all on function public.travel_resume(uuid, double precision, double precision, text) from public, anon;
grant execute on function public.travel_reach(uuid, text, text, text, double precision, double precision, text, numeric, numeric, text, double precision, double precision) to authenticated, service_role;
grant execute on function public.travel_resume(uuid, double precision, double precision, text) to authenticated, service_role;
