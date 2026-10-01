/*
  te_0006 — photographs may wait, and a claim can be deleted.

  1. Photographs. A stop could not be closed, and a fare-paid leg could not
     be ended, without a photograph taken in the app. On a computer with no
     camera that stops a trip dead: the user's own test trip sat at a stop it
     could not leave (1 Oct: "make this image not mandatory now, bcz i cant
     test now"). Whether photographs are required is now a setting,
     photos_required, switched OFF by this migration and switched by the
     software administrator on the Rates page. While it is off a stop may be
     closed, and a bus, train or auto leg ended, with no photograph; where
     the phone is, is still read and still required. A photograph that IS
     given is checked exactly as before. A stop or leg without one shows as
     such on the claim, so the manager sees it.

     It is to be switched back on before the module is given to engineers:
     the photograph is the proof the whole module rests on.

  2. Deleting. There was no way to remove a trip — a test, a trip started by
     mistake (the user, 1 Oct: "need delete button for each claim"). The
     engineer may delete a claim of their own that the manager does not
     hold: one still on the road, ended but not submitted, or sent back. The
     software administrator may delete any. Its legs and stops go with it; a
     facility whose place was learned from it and never agreed by a manager
     goes too, so a test visit does not leave a hospital in the wrong place.
     What was deleted, and by whom, is written to the audit log. The trip's
     number is not used again.

     The photographs are files, removed by the app before the claim is; the
     storage rule below lets the same people who may delete the claim remove
     them.
*/
insert into public.travel_settings (key, value) values ('photos_required', 'false'::jsonb)
on conflict (key) do nothing;

/** Are photographs required to close a stop or end a fare-paid leg? Yes unless the setting says no. */
create or replace function public.travel_photos_required()
returns boolean language sql stable security definer set search_path to 'public' as $fn$
  select coalesce((select (value #>> '{}')::boolean from travel_settings where key = 'photos_required'), true)
$fn$;

create or replace function public.travel_set_photos_required(p_on boolean)
returns void language plpgsql security definer set search_path to 'public' as $fn$
begin
  if not is_sw_admin() then raise exception 'Only the software administrator can change this'; end if;
  if p_on is null then raise exception 'Say whether photographs are required'; end if;
  insert into travel_settings (key, value) values ('photos_required', to_jsonb(p_on))
  on conflict (key) do update set value = excluded.value;
  perform log_audit('travel_setting', null, 'photos_required', jsonb_build_object('on', p_on));
end $fn$;

CREATE OR REPLACE FUNCTION public.travel_close_stop(p_stop_id uuid, p_proof_path text, p_lat double precision, p_lng double precision, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s      travel_stops;
  t      travel_trips;
  f      travel_facilities;
  radius int := coalesce((select (value #>> '{}')::int from travel_settings where key = 'facility_radius_m'), 300);
  key    text;
  dist   int;
  flag   boolean := false;
begin
  select * into s from travel_stops where id = p_stop_id;
  if not found then raise exception 'That stop does not exist'; end if;
  t := travel_mine_running(s.trip_id);
  if s.closed_at is not null then raise exception 'This stop is already closed'; end if;
  -- A photograph that is given must be this trip's own; one that is not given is refused only while photographs are required.
  if (p_proof_path is null and travel_photos_required()) or (p_proof_path is not null and not travel_file_ok(t.id, p_proof_path)) then
    raise exception 'Take the proof photograph first';
  end if;
  if not travel_point_ok(p_lat, p_lng) then
    raise exception '%', case when p_proof_path is null then 'Your location could not be read — allow location and try again'
                              else 'The photograph has no location — allow location and take it again' end;
  end if;
  key := lower(regexp_replace(s.facility_name, '[^a-zA-Z0-9]+', '', 'g'));
  select * into f from travel_facilities where name_key = key;
  if not found then
    -- The first visit: this is where the facility is, once the manager agrees.
    insert into travel_facilities (name, name_key, lat, lng, learned_from, created_by)
    values (s.facility_name, key, p_lat, p_lng, s.id, current_employee_id()) returning * into f;
  elsif f.status = 'approved' then
    dist := round(travel_line_km(f.lat, f.lng, p_lat, p_lng) * 1000);
    flag := dist > radius;
  end if;
  update travel_stops
     set closed_at = now(), proof_path = p_proof_path, proof_lat = p_lat, proof_lng = p_lng, proof_at = case when p_proof_path is not null then now() end,
         facility_id = f.id, distance_m = dist, flagged = flag,
         note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note)
   where id = s.id;
  return jsonb_build_object('flagged', flag, 'distance_m', dist, 'facility_status', f.status);
end $function$;

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
    if (p_bill_path is null and travel_photos_required()) or (p_bill_path is not null and not travel_file_ok(p_trip.id, p_bill_path)) then
      raise exception 'Take a photograph of the % bill', lower(m.label);
    end if;
    if p_bill_path is not null and not travel_point_ok(p_bill_lat, p_bill_lng) then raise exception 'The bill photograph has no location — allow location and take it again'; end if;
  end if;
  update travel_legs
     set to_lat = p_lat, to_lng = p_lng, to_at = now(), road_km = road, line_km = line, km_source = src,
         rate = m.per_km,
         fare = case when m.per_km is null then round(p_fare, 2) end,
         amount = case when m.per_km is null then round(p_fare, 2) else round(road * m.per_km, 2) end,
         bill_path = case when m.per_km is null then p_bill_path end,
         bill_lat = case when m.per_km is null then p_bill_lat end,
         bill_lng = case when m.per_km is null then p_bill_lng end,
         bill_at = case when m.per_km is null and p_bill_path is not null then now() end
   where id = l.id;
  perform travel_retotal(p_trip.id);
end $function$;

/** Who may delete a claim: its engineer while the manager does not hold it, or the software administrator. */
create or replace function public.travel_delete(p_trip_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare t travel_trips := travel_lock(p_trip_id);
begin
  if not is_sw_admin() then
    if t.employee_id is distinct from current_employee_id() then raise exception 'This is not your claim'; end if;
    if t.status not in ('open', 'returned') then
      raise exception 'This claim is with your manager or already approved — only the software administrator can delete it';
    end if;
  end if;
  -- A place learned from this trip and never agreed by a manager goes with it; one that was agreed stays.
  delete from travel_facilities f where f.status = 'pending' and f.learned_from in (select s.id from travel_stops s where s.trip_id = t.id);
  update travel_facilities f set learned_from = null where f.learned_from in (select s.id from travel_stops s where s.trip_id = t.id);
  perform log_audit('travel_trip', t.id, 'deleted', jsonb_build_object(
    'code', t.code, 'employee_id', t.employee_id, 'status', t.status, 'started_at', t.started_at, 'ended_at', t.ended_at,
    'total_km', t.total_km, 'total_amount', t.total_amount,
    'legs', (select count(*) from travel_legs l where l.trip_id = t.id), 'stops', (select count(*) from travel_stops s where s.trip_id = t.id)));
  delete from travel_trips where id = t.id;
end $fn$;

revoke all on function public.travel_photos_required() from public, anon;
revoke all on function public.travel_set_photos_required(boolean) from public, anon;
revoke all on function public.travel_delete(uuid) from public, anon;
grant execute on function public.travel_photos_required() to authenticated, service_role;
grant execute on function public.travel_set_photos_required(boolean) to authenticated, service_role;
grant execute on function public.travel_delete(uuid) to authenticated, service_role;

create policy travel_proofs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'travel-proofs' and exists (
    select 1 from public.travel_trips t where t.id::text = (storage.foldername(name))[1]
      and (public.is_sw_admin() or (t.employee_id = public.current_employee_id() and t.status in ('open', 'returned')))));
