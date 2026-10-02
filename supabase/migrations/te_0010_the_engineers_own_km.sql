/*
  te_0010 — the engineer's own kilometres, beside the ones worked out.

  A ride paid by the kilometre is measured for the engineer: the road
  between where it began and where it ended, from the map. The engineer had
  no way to say what their own odometer read (the user, 2 Oct: "for the bike
  and car we are auto calculating km, but need option to give option to
  enter km for eng also, and just show what km we got and what eng
  inputted, both should be shown so manager can see also").

  So a ride may carry a second figure, claimed_km: what the engineer says it
  was. It is shown beside the worked-out distance, to the engineer and to
  the manager, and it changes nothing else — the ride is still paid on the
  distance worked out. It is the engineer's to give or correct while the
  claim is theirs to change: before it is submitted, or after it is sent
  back. Only on a ride that has ended and is paid by the kilometre; a fare
  has no distance to disagree about.
*/
alter table public.travel_legs
  add column if not exists claimed_km numeric(8,2) check (claimed_km is null or (claimed_km > 0 and claimed_km <= 2000));

/** The engineer's own figure for one of their rides; null takes it away. */
create or replace function public.travel_claim_km(p_leg_id uuid, p_km numeric)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare
  l travel_legs;
  t travel_trips;
begin
  select * into l from travel_legs where id = p_leg_id;
  if not found then raise exception 'That ride does not exist'; end if;
  t := travel_lock(l.trip_id);
  if t.employee_id is distinct from current_employee_id() then raise exception 'This is not your trip'; end if;
  if t.status not in ('open', 'returned') then raise exception 'This claim is with your manager or already approved — its figures cannot be changed'; end if;
  if l.to_at is null then raise exception 'This ride has not ended yet'; end if;
  if l.rate is null then raise exception 'This ride is paid on its fare, not by the kilometre'; end if;
  if p_km is not null and (p_km <= 0 or p_km > 2000) then raise exception 'Enter the kilometres, more than 0 and up to 2000'; end if;
  update travel_legs set claimed_km = round(p_km, 2) where id = l.id;
end $fn$;

revoke all on function public.travel_claim_km(uuid, numeric) from public, anon;
grant execute on function public.travel_claim_km(uuid, numeric) to authenticated, service_role;
