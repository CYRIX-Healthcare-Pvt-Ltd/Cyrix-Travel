/*
  te_0168 · Aurum claim windows and directors (the user, 20 Nov).
  - A claim whose reporting manager is a director (employees.is_director, KPI 0306) skips the manager step: it goes to
    the coordinator, or the Travel Desk when there is none.
  - Aurum (grades E1–E6): no monthly due date; each day is due within 45 days of its date, and an outstation day
    within 7 days of its trip's End my day; past that, the late % by month (te_pol late_pct), past the steps refused.
  - Aurum days: under 100 km from home by road (te_save_day) cannot take per diem or food; Service Call tickets need
    te_tickets.asset_no and service_report.
  te_submit and te_save_day otherwise as live.
*/
create or replace function public.te_submit(p_claim uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c te_claims; due date; late int := 0; steps jsonb := te_pol('late_pct'); over numeric := (te_pol('bill_over'))::text::numeric; missing text;
  aurum boolean; worst date; nxt text; near_m numeric := coalesce((te_pol('photo_near_m'))::text::numeric, 500); lim int := coalesce((te_pol('photo_skips'))::text::int, 3); used int;
begin
  select * into c from te_claims where id = p_claim;
  if not te_can_edit(p_claim) then raise exception 'This claim cannot be sent now'; end if;
  if not exists (select 1 from te_days where claim_id = p_claim) then raise exception 'Add at least one day first'; end if;
  -- End my day for each day started or photographed (te_0150).
  select string_agg(to_char(d.day, 'FMDD Mon'), ', ' order by d.day) into missing
    from te_days d
   where d.claim_id = p_claim and d.day >= coalesce(te_end_first_from(c.employee_id), '2999-12-31')
     and (exists (select 1 from te_day_starts s where s.employee_id = c.employee_id and s.day = d.day)
          or exists (select 1 from te_visit_photos v where v.employee_id = c.employee_id and v.day = d.day))
     and not exists (select 1 from te_day_ends e where e.employee_id = c.employee_id and e.day = d.day);
  if missing is not null then raise exception 'End my day for % first', missing; end if;
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
     and not exists (select 1 from te_route_shots s where s.claim_id = p_claim and s.ride_id = r.id and s.places in ('match', 'named', 'unread'));
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
  aurum := coalesce((select grade ~ '^E[1-6]$' from employees where id = c.employee_id), false);
  if aurum then
    /* Aurum (te_0168; the user, 20 Nov): each day within 45 days of its date, and an outstation day within 7 days of
       the End my day of the trip's last day (a run of outstation days in a row). Late days take the late % by the
       month started past the window, as Cyrix claims do; later than the steps allow is refused. */
    select min(dl) into worst from (
      select d.day + 45 as dl from te_days d where d.claim_id = p_claim
      union all
      select coalesce(e.day, r.last_day) + 7 from (
        select d.day, (select min(x.day) from te_days x where x.claim_id = p_claim and x.da_kind like 'aurum%' and x.day >= d.day
                         and not exists (select 1 from te_days y where y.claim_id = p_claim and y.day = x.day + 1 and y.da_kind like 'aurum%')) as last_day
        from te_days d where d.claim_id = p_claim and d.da_kind like 'aurum%') r
      left join te_day_ends e on e.employee_id = c.employee_id and e.day = r.last_day) w;
    if current_date > worst then
      late := ceil((current_date - worst) / 30.0)::int;
      if late > jsonb_array_length(steps) then raise exception 'This claim is more than % months past its last date and cannot be claimed', jsonb_array_length(steps); end if;
      late := (steps->>(late - 1))::int;
    end if;
  else
  -- Late: due by the 5th of the next month; 1, 2, 3 months after that take 10, 20, 30 percent; later is refused.
  due := (c.month + interval '1 month')::date + ((te_pol('submit_by_day'))::text::int - 1);
  if current_date > due then
    late := ((extract(year from age(current_date, due)) * 12 + extract(month from age(current_date, due)))::int) + 1;
    if late > jsonb_array_length(steps) then raise exception 'This month is more than % months late and cannot be claimed', jsonb_array_length(steps); end if;
    late := (steps->>(late - 1))::int;
  end if;
  end if;
  /* A director as the reporting manager (0306): straight to the coordinator, or the Travel Desk (te_0168; the user, 20 Nov). */
  nxt := case when exists (select 1 from employees e join employees m on m.id = e.reporting_manager_id where e.id = c.employee_id and m.is_director)
              then case when te_claim_coordinator(p_claim) is not null then 'with_coordinator' else 'with_desk' end else 'with_manager' end;
  update te_claims set status = nxt, submitted_at = now(), late_pct = late, return_note = null,
    number = coalesce(number, te_number(nextval('te_claim_seq')::int)),
    updated_at = now()
  where id = p_claim returning number into c.number;
  return c.number;
end $function$;

alter table public.te_tickets add column if not exists asset_no text;

create or replace function public.te_save_day(p_claim uuid, p_day jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c te_claims; r te_grade_rules; did uuid := (p_day->>'id')::uuid; x jsonb; amt numeric; n int := 0;
  other text;
  hm travel_homes; wk travel_works; com boolean;
  aurum boolean; far int; out_km numeric; bad text;
begin
  select * into c from te_claims where id = p_claim;
  if not te_can_edit(p_claim) then raise exception 'This claim cannot be changed now'; end if;
  if (p_day->>'day')::date < c.month or (p_day->>'day')::date >= (c.month + interval '1 month') then
    raise exception 'That date is not in this month''s claim';
  end if;
  -- A day is added within claim_within_days of it, today counted (te_0093); a day saved in time keeps its date.
  if te_claim_from() is not null and (p_day->>'day')::date < te_claim_from()
     and not exists (select 1 from te_days where id = did and day = (p_day->>'day')::date) then
    raise exception 'Only days from % can be added', to_char(te_claim_from(), 'Dy FMDD Mon');
  end if;
  r := te_rule(c.grade);
  select * into hm from travel_homes where employee_id = c.employee_id;
  select * into wk from travel_works where employee_id = c.employee_id;
  if p_day->>'da_kind' = 'aurum_per_diem' and coalesce((p_day->'hotel'->>'amount')::numeric, 0) > 0 then
    raise exception 'Per diem is paid only without a room stay. Choose Actual food, or remove the room';
  end if;
  aurum := coalesce(c.grade ~ '^E[1-6]$', false);
  /* Aurum (te_0168; the user, 20 Nov): a day that starts from home and goes less than 100 km out by road (the rides'
     km up to the place farthest from home) is local travel: no per diem, no food at actual. */
  if aurum and coalesce(p_day->>'da_kind', 'none') like 'aurum%' and hm.employee_id is not null
     and jsonb_array_length(coalesce(p_day->'rides', '[]')) > 0
     and nullif(p_day->'rides'->0->>'from_lat', '') is not null
     and te_km(hm.lat, hm.lng, (p_day->'rides'->0->>'from_lat')::float8, (p_day->'rides'->0->>'from_lng')::float8) <= 0.5 then
    select o into far from jsonb_array_elements(p_day->'rides') with ordinality v(rr, o)
     where nullif(rr->>'to_lat', '') is not null
     order by te_km(hm.lat, hm.lng, (rr->>'to_lat')::float8, (rr->>'to_lng')::float8) desc limit 1;
    select coalesce(sum(coalesce(nullif(rr->>'claimed_km', '')::numeric, nullif(rr->>'map_km', '')::numeric, 0)), 0) into out_km
      from jsonb_array_elements(p_day->'rides') with ordinality v(rr, o) where o <= coalesce(far, 0);
    if out_km < 100 then
      raise exception 'Only % km from home by road, under 100 km: local travel, no per diem or food. Choose None', round(out_km);
    end if;
  end if;
  -- Aurum service calls carry the asset / MPT number and the service report number (te_0168).
  if aurum then
    select string_agg(coalesce(nullif(trim(v->>'ticket_no'), ''), 'a service call'), ', ') into bad
      from jsonb_array_elements(coalesce(p_day->'tickets', '[]')) v
     where coalesce(trim(v->>'asset_no'), '') = '' or coalesce(trim(v->>'service_report'), '') = '';
    if bad is not null then raise exception 'Enter the asset / MPT number and the service report number for %', bad; end if;
  end if;
  if p_day->>'da_kind' = 'deputation' and te_dep_on(c.employee_id, (p_day->>'day')::date) is null then
    raise exception '% is not in an approved deputation — choose another DA', to_char((p_day->>'day')::date, 'FMDD Mon');
  end if;
  -- One claim a day, so one DA a day (the user, 23 Oct): a date already in another of this person's claims is refused.
  select coalesce(k.number, 'your ' || to_char(k.month, 'FMMon') || ' draft') into other
    from te_days d join te_claims k on k.id = d.claim_id
   where k.employee_id = c.employee_id and k.id <> p_claim and d.day = (p_day->>'day')::date limit 1;
  if other is not null then
    raise exception '% is already claimed in % — one claim a day', to_char((p_day->>'day')::date, 'FMDD Mon'), other;
  end if;
  other := null;
  insert into te_days (id, claim_id, day, place, district, purpose, da_kind, da_amount, continues_day, remarks, place_lat, place_lng, da_auto, dep_off)
  values (did, p_claim, (p_day->>'day')::date, p_day->>'place', p_day->>'district', p_day->>'purpose',
    coalesce(p_day->>'da_kind', 'none'), te_da(c.grade, coalesce(p_day->>'da_kind', 'none'), p_day->>'purpose', c.designation),
    nullif(p_day->>'continues_day', '')::date, p_day->>'remarks',
    nullif(p_day->>'place_lat', '')::float8, nullif(p_day->>'place_lng', '')::float8, nullif(p_day->>'da_auto', ''), nullif(p_day->>'dep_off', ''))
  on conflict (id) do update set day = excluded.day, place = excluded.place, district = excluded.district,
    purpose = excluded.purpose, da_kind = excluded.da_kind, da_amount = excluded.da_amount,
    continues_day = excluded.continues_day, remarks = excluded.remarks,
    place_lat = excluded.place_lat, place_lng = excluded.place_lng, da_auto = excluded.da_auto, dep_off = excluded.dep_off;

  delete from te_rides where day_id = did and id not in (select (v->>'id')::uuid from jsonb_array_elements(coalesce(p_day->'rides', '[]')) v);
  for x in select * from jsonb_array_elements(coalesce(p_day->'rides', '[]')) loop
    n := n + 1;
    amt := case x->>'mode'
      when 'bike' then coalesce((x->>'claimed_km')::numeric, 0) * coalesce(r.bike_rate, 5)
      when 'car'  then coalesce((x->>'claimed_km')::numeric, 0) * coalesce(r.car_rate, 11)
      else coalesce((x->>'fare')::numeric, 0) end;
    -- Home to work or work to home is the daily commute: nothing claimed, whatever the mode (te_0085).
    com := hm.employee_id is not null and wk.employee_id is not null
      and nullif(x->>'from_lat', '') is not null and nullif(x->>'to_lat', '') is not null
      and ((te_km(hm.lat, hm.lng, (x->>'from_lat')::float8, (x->>'from_lng')::float8) <= 0.3 and te_km(wk.lat, wk.lng, (x->>'to_lat')::float8, (x->>'to_lng')::float8) <= 0.3)
        or (te_km(wk.lat, wk.lng, (x->>'from_lat')::float8, (x->>'from_lng')::float8) <= 0.3 and te_km(hm.lat, hm.lng, (x->>'to_lat')::float8, (x->>'to_lng')::float8) <= 0.3));
    if com then amt := 0; end if;
    insert into te_rides (id, day_id, seq, from_name, from_lat, from_lng, to_name, to_lat, to_lng, mode, claimed_km, map_km, fare, amount, note, inter, same_ticket, ticket_date, return_leg, purpose, project, photo_skip, commute, route_km, route_alts, route_why)
    values ((x->>'id')::uuid, did, n, x->>'from_name', (x->>'from_lat')::float8, (x->>'from_lng')::float8,
      x->>'to_name', (x->>'to_lat')::float8, (x->>'to_lng')::float8, x->>'mode',
      nullif(x->>'claimed_km', '')::numeric, nullif(x->>'map_km', '')::numeric, nullif(x->>'fare', '')::numeric, round(amt, 2), x->>'note', nullif(x->>'inter', '')::boolean, case when jsonb_typeof(x->'same_ticket') = 'object' then x->'same_ticket' end, nullif(x->>'ticket_date', '')::date, case when jsonb_typeof(x->'return_leg') = 'object' then x->'return_leg' end,
      nullif(btrim(x->>'purpose'), ''), nullif(btrim(x->>'project'), ''), nullif(btrim(x->>'photo_skip'), ''), coalesce(com, false), nullif(x->>'route_km', '')::numeric, case when jsonb_typeof(x->'route_alts') = 'object' then x->'route_alts' end, nullif(btrim(x->>'route_why'), ''))
    on conflict (id) do update set seq = excluded.seq, from_name = excluded.from_name, from_lat = excluded.from_lat,
      from_lng = excluded.from_lng, to_name = excluded.to_name, to_lat = excluded.to_lat, to_lng = excluded.to_lng,
      mode = excluded.mode, claimed_km = excluded.claimed_km, map_km = excluded.map_km, fare = excluded.fare,
      amount = excluded.amount, note = excluded.note, inter = excluded.inter, same_ticket = excluded.same_ticket, ticket_date = excluded.ticket_date, return_leg = excluded.return_leg,
      purpose = excluded.purpose, project = excluded.project, photo_skip = excluded.photo_skip, commute = excluded.commute, route_km = excluded.route_km, route_alts = excluded.route_alts, route_why = excluded.route_why;
  end loop;

  delete from te_tickets where day_id = did and id not in (select (v->>'id')::uuid from jsonb_array_elements(coalesce(p_day->'tickets', '[]')) v);
  insert into te_tickets (id, day_id, ticket_no, service_report, place, asset_no)
  select (v->>'id')::uuid, did, trim(v->>'ticket_no'), nullif(trim(v->>'service_report'), ''), nullif(trim(v->>'place'), ''), nullif(trim(v->>'asset_no'), '')
  from jsonb_array_elements(coalesce(p_day->'tickets', '[]')) v where coalesce(trim(v->>'ticket_no'), '') <> ''
  on conflict (id) do update set ticket_no = excluded.ticket_no, service_report = excluded.service_report, place = excluded.place, asset_no = excluded.asset_no;

  -- One hotel night. A room a colleague already claimed with this person cannot be claimed again (policy: no split claims).
  -- A night the company paid claims ₹0 and is kept (te_0043).
  if p_day->'hotel' is not null and jsonb_typeof(p_day->'hotel') = 'object' and (coalesce((p_day->'hotel'->>'amount')::numeric, 0) > 0
     or exists (select 1 from te_hotels hh where hh.id = (p_day->'hotel'->>'id')::uuid and hh.company_booking is not null)
     or exists (select 1 from te_bills bb where bb.owner_id = (p_day->'hotel'->>'id')::uuid and te_bill_company(bb) is not null)) then
    select e.full_name || ' (' || e.ecode || ')' into other
    from te_hotels h join te_days d on d.id = h.day_id join te_claims k on k.id = d.claim_id join employees e on e.id = k.employee_id
    where h.shared_with = c.employee_id and d.day = (p_day->>'day')::date and k.id <> p_claim limit 1;
    if other is not null then raise exception 'This room is already claimed by % for that night', other; end if;
    insert into te_hotels (id, day_id, name, note, amount, occupancy, metro, shared_with)
    values ((p_day->'hotel'->>'id')::uuid, did, p_day->'hotel'->>'name', nullif(btrim(p_day->'hotel'->>'note'), ''), (p_day->'hotel'->>'amount')::numeric,
      coalesce(p_day->'hotel'->>'occupancy', 'single'), coalesce((p_day->'hotel'->>'metro')::boolean, false),
      (select id from employees where ecode = upper(trim(p_day->'hotel'->>'shared_ecode'))))
    on conflict (day_id) do update set id = excluded.id, name = excluded.name, note = excluded.note,
      amount = case when te_hotels.company_booking is not null then te_hotels.amount else excluded.amount end,
      occupancy = excluded.occupancy, metro = excluded.metro, shared_with = excluded.shared_with;
  else
    delete from te_hotels where day_id = did;
  end if;

  delete from te_expenses where day_id = did and id not in (select (v->>'id')::uuid from jsonb_array_elements(coalesce(p_day->'expenses', '[]')) v);
  insert into te_expenses (id, day_id, category, description, amount)
  select (v->>'id')::uuid, did, v->>'category', v->>'description', coalesce((v->>'amount')::numeric, 0)
  from jsonb_array_elements(coalesce(p_day->'expenses', '[]')) v where coalesce((v->>'amount')::numeric, 0) > 0
  on conflict (id) do update set category = excluded.category, description = excluded.description, amount = excluded.amount;

  -- Bills whose row is gone go with it; a service report with its ticket (te_0037).
  delete from te_bills b where b.claim_id = p_claim and b.owner_id not in (
    select id from te_rides where day_id in (select id from te_days where claim_id = p_claim)
    union select id from te_hotels where day_id in (select id from te_days where claim_id = p_claim)
    union select id from te_expenses where day_id in (select id from te_days where claim_id = p_claim)
    union select id from te_tickets where day_id in (select id from te_days where claim_id = p_claim))
    and b.created_at < now() - interval '1 day';
  -- Each ticket's hospital learned for everyone (te_0038).
  perform te_learn_places(did, coalesce(p_day->'tickets', '[]'));
  -- A ride or night the company booked claims nothing (te_0042).
  perform te_apply_company(p_claim);
  update te_claims set updated_at = now() where id = p_claim;
  return did;
end $function$;
