/*
  te_0145 — The Google Maps screenshot for everybody (the user, 9 Nov: "roll out g map screenshot to all users"): te_submit
  no longer keeps its two checks to the test accounts;
  a screenshot is asked for on ride days from 10 Nov. The app's gate (routeShotsOn) goes in the same release.
*/
CREATE OR REPLACE FUNCTION public.te_submit(p_claim uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c te_claims; due date; late int := 0; steps jsonb := te_pol('late_pct'); over numeric := (te_pol('bill_over'))::text::numeric; missing text;
  near_m numeric := coalesce((te_pol('photo_near_m'))::text::numeric, 500); lim int := coalesce((te_pol('photo_skips'))::text::int, 3); used int;
begin
  select * into c from te_claims where id = p_claim;
  if not te_can_edit(p_claim) then raise exception 'This claim cannot be sent now'; end if;
  if not exists (select 1 from te_days where claim_id = p_claim) then raise exception 'Add at least one day first'; end if;
  -- Bills the policy asks for, each named (the user, 19 Oct: "don't know in which is having error").
  select string_agg(item, '; ' order by ord, item) into missing from (
    select d.day as ord, to_char(d.day, 'FMDD Mon') || ' · ' || case r.mode when 'taxi_bike' then 'Uber / Taxi bike' when 'taxi' then 'Uber / Taxi car' else initcap(r.mode) end || ' ride ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1) as item
    from te_rides r join te_days d on d.id = r.day_id
    where d.claim_id = p_claim and r.same_ticket is null and r.mode not in ('bike', 'car') and (r.amount > over or r.mode = 'taxi_bike') and not exists (select 1 from te_bills b where b.owner_id = r.id)
    union all
    select d.day, to_char(d.day, 'FMDD Mon') || ' · Hotel night' from te_hotels h join te_days d on d.id = h.day_id
    where d.claim_id = p_claim and h.amount > over and not exists (select 1 from te_bills b where b.owner_id = h.id)
    union all
    select d.day, to_char(d.day, 'FMDD Mon') || ' · ' || x.category from te_expenses x join te_days d on d.id = x.day_id
    where d.claim_id = p_claim and (x.amount > over or x.category in (select label from te_expense_kinds where bill_always)) and not exists (select 1 from te_bills b where b.owner_id = x.id)
  ) s;
  if missing is not null then raise exception 'Attach the bill for %', missing; end if;
  -- A ride whose purpose asks for a ticket ID names its ticket (te_0060; te_0105 by the tick, not the name).
  select string_agg(to_char(d.day, 'FMDD Mon') || ' · ' || initcap(r.mode) || ' ride ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1), '; ' order by d.day, r.seq)
    into missing
    from te_rides r join te_days d on d.id = r.day_id
   where d.claim_id = p_claim and te_needs_ticket(r.purpose)
     and not exists (select 1 from te_tickets t where t.id = r.id and btrim(t.ticket_no) <> '');
  if missing is not null then raise exception 'Enter the ticket ID for %', missing; end if;
  -- A bike or car ride claimed over the map's km and 1 km for every started 10 km of it carries a Google Maps screenshot (te_0140, te_0142).
  select string_agg(to_char(d.day, 'FMDD Mon') || ' · ' || initcap(r.mode) || ' ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1), '; ' order by d.day, r.seq)
    into missing
    from te_rides r join te_days d on d.id = r.day_id
   where d.claim_id = p_claim and r.mode in ('bike', 'car') and r.map_km > 0
     -- Rides from 10 Nov (the user, 9 Nov: "from 2mrws claim only needed, todays unsend no issue").
     -- The test accounts any day (the user, 9 Nov: "for test accounts there is not date or starting").
     and (d.day >= date '2026-11-10' or te_is_test(c.employee_id))
     and r.claimed_km > te_km_allowed(r.map_km)
     and not exists (select 1 from te_route_shots s where s.claim_id = p_claim and s.ride_id = r.id and s.places in ('match', 'unread'));
  if missing is not null then raise exception 'Add the Google Maps screenshot for %', missing; end if;
  -- No more than the screenshot's km, nor a screenshot of other points than the ride's (te_0141).
  select string_agg(to_char(d.day, 'FMDD Mon') || ' · ' || initcap(r.mode) || ' ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1), '; ' order by d.day, r.seq)
    into missing
    from te_rides r join te_days d on d.id = r.day_id join te_route_shots s on s.claim_id = p_claim and s.ride_id = r.id
   where d.claim_id = p_claim and s.km is not null and r.claimed_km > s.km + 0.5;
  if missing is not null then raise exception 'The km is more than the Google Maps screenshot for %', missing; end if;
  -- Remarks on every flight, train and hotel night (te_0042; the user, 21 Oct).
  select string_agg(item, '; ' order by ord, item) into missing from (
    select d.day as ord, to_char(d.day, 'FMDD Mon') || ' · ' || initcap(r.mode) || ' ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1) as item
    from te_rides r join te_days d on d.id = r.day_id
    where d.claim_id = p_claim and r.mode in ('flight', 'train') and coalesce(btrim(r.note), '') = ''
    union all
    select d.day, to_char(d.day, 'FMDD Mon') || ' · Hotel night' from te_hotels h join te_days d on d.id = h.day_id
    where d.claim_id = p_claim and coalesce(btrim(h.note), '') = ''
  ) s;
  if missing is not null then raise exception 'Write the remarks for %', missing; end if;
  -- Visit photos (te_0082, te_0092): a ride for a purpose needing one has its own photo that day within reach, or "Photo not possible" with a reason.
  if coalesce((te_pol('visit_photos'))::text::boolean, false) then
    select string_agg(to_char(d.day, 'FMDD Mon') || ' · ' || initcap(r.mode) || ' ride ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1), '; ' order by d.day, r.seq)
      into missing
      from te_rides r join te_days d on d.id = r.day_id
     where d.claim_id = p_claim and r.purpose in (select label from te_purposes where photo_needed)
       and r.to_lat is not null and (lower(btrim(split_part(coalesce(r.to_name, ''), ',', 1))) <> 'home'
       or (d.day >= coalesce((te_pol('home_mid_photo_from') #>> '{}')::date, '2999-12-31') and exists (select 1 from te_rides y where y.day_id = r.day_id and y.seq > r.seq and y.to_lat is not null)))
       and coalesce(btrim(r.photo_skip), '') = ''
       and r.id in (select te_rides_without_photo(p_claim));
    if missing is not null then raise exception 'Take the visit photo, or choose Photo not possible, for %', missing; end if;
    if coalesce(te_pol('photo_after') #>> '{}', 'block') = 'block' then
      select count(*) into used from te_rides r join te_days d on d.id = r.day_id join te_claims k on k.id = d.claim_id
       where k.employee_id = c.employee_id and k.month = c.month and coalesce(btrim(r.photo_skip), '') <> '' and (k.id = p_claim or k.status <> 'draft');
      if used > lim then raise exception 'Photo not possible is chosen % times in %. The limit is % a month', used, to_char(c.month, 'FMMonth'), lim; end if;
    end if;
  end if;
  -- Late: due by the 5th of the next month; 1, 2, 3 months after that take 10, 20, 30 percent; later is refused.
  due := (c.month + interval '1 month')::date + ((te_pol('submit_by_day'))::text::int - 1);
  if current_date > due then
    late := ((extract(year from age(current_date, due)) * 12 + extract(month from age(current_date, due)))::int) + 1;
    if late > jsonb_array_length(steps) then raise exception 'This month is more than % months late and cannot be claimed', jsonb_array_length(steps); end if;
    late := (steps->>(late - 1))::int;
  end if;
  update te_claims set status = 'with_manager', submitted_at = now(), late_pct = late, return_note = null,
    number = coalesce(number, te_number(nextval('te_claim_seq')::int)),
    updated_at = now()
  where id = p_claim returning number into c.number;
  return c.number;
end $function$;
