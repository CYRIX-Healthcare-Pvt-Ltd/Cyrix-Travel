/*
  te_0004 — a leg's distance goes through its stops.

  A leg ran from where it began to where it ended, and its distance was the
  road between those two points. The stops reached on the way took no part:
  an engineer who rode from home to a hospital and home again on one bike
  leg began and ended at the same place, and was paid for no distance at
  all (the user, 1 Oct, on the Reached form: "facility or place also need
  mark my location then only we can get distance isnt").

  The place of each stop was already read at "I am here". It now counts: the
  straight line a road distance is checked against is taken from the leg's
  start, through every stop reached on that leg in the order they were
  reached, to its end. The app works the road distance out through the same
  points. Nothing else of the function changes — the same bounds, the same
  fall back to the straight line when the road figure is not believable.

  A leg with no stop on it is measured exactly as before. Legs already
  closed are not touched.
*/
CREATE OR REPLACE FUNCTION public.travel_close_leg(p_trip travel_trips, p_lat double precision, p_lng double precision, p_road_km numeric, p_fare numeric, p_bill_path text, p_bill_lat double precision, p_bill_lng double precision)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  l    travel_legs;
  m    travel_modes;
  line numeric;
  road numeric;
  src  text;
begin
  select * into l from travel_legs where trip_id = p_trip.id and to_at is null order by seq desc limit 1 for update;
  if not found then raise exception 'There is no leg running'; end if;
  select * into m from travel_modes where mode = l.mode;
  -- The straight line is taken through every stop reached on this leg, in the order they were
  -- reached: home to a hospital and home again is twice the way there, not nothing.
  select coalesce(sum(travel_line_km(a_lat, a_lng, b_lat, b_lng)), 0) into line
    from (select lat b_lat, lng b_lng, lag(lat) over (order by ord) a_lat, lag(lng) over (order by ord) a_lng
            from (select 0 ord, l.from_lat lat, l.from_lng lng
                  union all
                  select s.seq, s.lat, s.lng from travel_stops s where s.trip_id = p_trip.id and s.reached_at >= l.from_at
                  union all
                  select 2147483647, p_lat, p_lng) pts) hops
   where a_lat is not null;
  -- A road is never shorter than the straight line, and seldom three times it: outside that, the line stands.
  if p_road_km is not null and p_road_km >= line * 0.98 and p_road_km <= greatest(line * 3, line + 5) then
    road := round(p_road_km, 2); src := 'route';
  else
    road := round(line, 2); src := 'line';
  end if;
  if m.per_km is null then
    if p_fare is null then raise exception 'Enter the fare for the % leg', lower(m.label); end if;
    if p_bill_path is null or not travel_file_ok(p_trip.id, p_bill_path) then
      raise exception 'Take a photograph of the % bill', lower(m.label);
    end if;
    if not travel_point_ok(p_bill_lat, p_bill_lng) then raise exception 'The bill photograph has no location — allow location and take it again'; end if;
  end if;
  update travel_legs
     set to_lat = p_lat, to_lng = p_lng, to_at = now(), road_km = road, line_km = line, km_source = src,
         rate = m.per_km,
         fare = case when m.per_km is null then round(p_fare, 2) end,
         amount = case when m.per_km is null then round(p_fare, 2) else round(road * m.per_km, 2) end,
         bill_path = case when m.per_km is null then p_bill_path end,
         bill_lat = case when m.per_km is null then p_bill_lat end,
         bill_lng = case when m.per_km is null then p_bill_lng end,
         bill_at = case when m.per_km is null then now() end
   where id = l.id;
  perform travel_retotal(p_trip.id);
end $function$;
